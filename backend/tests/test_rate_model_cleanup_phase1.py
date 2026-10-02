"""Phase 1 rate-model cleanup checks that do not require PostgreSQL."""
from pathlib import Path

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
