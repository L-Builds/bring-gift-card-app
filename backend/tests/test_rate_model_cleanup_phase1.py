"""Phase 1 rate-model cleanup and backfill safeguards."""
import os
import uuid
from pathlib import Path

import psycopg
from psycopg import sql

from schema import SCHEMA_VERSION, detailed_rates, headline_rates


ROOT = Path(__file__).resolve().parents[1]


def test_new_headline_model_has_no_denomination_dependency():
    columns = set(headline_rates.c.keys())
    assert {"brand_id", "market_code", "rate_minor_per_unit", "version", "is_active"} <= columns
    assert not {"face_value", "payout_minor", "range_min", "range_max", "submission_type"} & columns


def test_new_detailed_model_is_card_country_type_rate_per_unit():
    columns = set(detailed_rates.c.keys())
    assert {"brand_id", "market_code", "card_country", "submission_type", "rate_minor_per_unit", "version", "is_active"} <= columns
    assert not {"face_value", "payout_minor", "range_min", "range_max", "is_headline"} & columns


def test_phase1_migration_preserves_legacy_rate_rows():
    sql = (ROOT / "migrations" / "012_rate_model_cleanup.sql").read_text(encoding="utf-8")
    upper = sql.upper()
    assert "CREATE TABLE HEADLINE_RATES" in upper
    assert "CREATE TABLE DETAILED_RATES" in upper
    assert "INSERT INTO HEADLINE_RATES" in upper
    assert "INSERT INTO DETAILED_RATES" in upper
    assert "UPDATE CARD_RATES" not in upper
    assert "DELETE FROM CARD_RATES" not in upper
    assert "DROP TABLE CARD_RATES" not in upper


def test_schema_requires_phase1_migration():
    assert SCHEMA_VERSION == "013_trade_rate_cutover"


def test_backfill_skips_group_with_an_unknown_per_unit_rate():
    """One convertible legacy row must not hide an ambiguous sibling row."""
    schema = "bgc_rate_migration_" + uuid.uuid4().hex
    with psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            with conn.transaction():
                conn.execute(sql.SQL("SET LOCAL search_path TO {}, public").format(sql.Identifier(schema)))
                for migration in sorted((ROOT / "migrations").glob("*.sql")):
                    if migration.stem >= "012_rate_model_cleanup":
                        break
                    conn.execute(migration.read_text(encoding="utf-8"), prepare=False)
                brand_id = conn.execute("SELECT id FROM brands WHERE name ILIKE '%apple%' LIMIT 1").fetchone()[0]
                conn.execute("""INSERT INTO card_rates
                    (_key, extra, id, brand_id, market_code, card_country, submission_type,
                     face_value, payout_minor, rate_minor_per_usd, version, is_active)
                    VALUES
                    ('mixed-unknown', '{}'::jsonb, 'mixed-unknown', %s, 'NG', 'ZZ', 'physical', 3, 5, NULL, 1, TRUE),
                    ('mixed-exact', '{}'::jsonb, 'mixed-exact', %s, 'NG', 'ZZ', 'physical', 1, 2, 2, 1, TRUE)
                    """, (brand_id, brand_id))
                conn.execute((ROOT / "migrations" / "012_rate_model_cleanup.sql").read_text(encoding="utf-8"), prepare=False)
                result = conn.execute("SELECT count(*) FROM detailed_rates WHERE brand_id=%s AND card_country='ZZ'", (brand_id,)).fetchone()[0]
                assert result == 0
        finally:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
