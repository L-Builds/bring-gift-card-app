"""Migration grants are repeatable and keep protected tables least privileged."""
import os
import uuid

import psycopg
import pytest

from scripts.migrate import migrate


def test_production_migration_requires_runtime_role(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("BGC_RUNTIME_ROLE", raising=False)
    with pytest.raises(RuntimeError, match="BGC_RUNTIME_ROLE is required"):
        migrate("postgresql://owner@example.invalid/app?sslmode=require")


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Requires disposable PostgreSQL TEST_DATABASE_URL")
def test_migration_reconciles_runtime_grants(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    url = os.environ["TEST_DATABASE_URL"]
    suffix = uuid.uuid4().hex[:12]
    schema = "bgc_grants_" + suffix
    role = "bgc_runtime_" + suffix
    runtime_role = psycopg.sql.Identifier(role)
    namespace = psycopg.sql.Identifier(schema)
    with psycopg.connect(url, autocommit=True) as owner:
        owner.execute(psycopg.sql.SQL("CREATE ROLE {} LOGIN NOINHERIT").format(runtime_role))
    try:
        migrate(url, schema, role)
        with psycopg.connect(url, autocommit=True) as owner:
            for table in ("popular_cards", "headline_rates", "detailed_rates"):
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                    assert owner.execute("SELECT has_table_privilege(%s, %s, %s)",
                                         (role, schema + "." + table, privilege)).fetchone()[0]
            for privilege, expected in (("SELECT", True), ("INSERT", True),
                                        ("UPDATE", False), ("DELETE", False)):
                assert owner.execute("SELECT has_table_privilege(%s, %s, %s)",
                                     (role, schema + ".ledger", privilege)).fetchone()[0] == expected
            assert owner.execute("SELECT has_table_privilege(%s, %s, 'SELECT')",
                                 (role, schema + ".schema_migrations")).fetchone()[0]
            assert not owner.execute("SELECT has_table_privilege(%s, %s, 'INSERT')",
                                     (role, schema + ".schema_migrations")).fetchone()[0]
            assert not owner.execute("SELECT has_schema_privilege(%s, %s, 'CREATE')",
                                     (role, schema)).fetchone()[0]

            # An already-applied migration run repairs both missing grants and
            # accidental extra rights without modifying migration checksums.
            owner.execute(psycopg.sql.SQL("REVOKE SELECT ON TABLE {} FROM {}").format(
                psycopg.sql.Identifier(schema, "headline_rates"), runtime_role))
            owner.execute(psycopg.sql.SQL("GRANT DELETE ON TABLE {} TO {}").format(
                psycopg.sql.Identifier(schema, "ledger"), runtime_role))
        migrate(url, schema, role)
        with psycopg.connect(url) as owner:
            assert owner.execute("SELECT has_table_privilege(%s, %s, 'SELECT')",
                                 (role, schema + ".headline_rates")).fetchone()[0]
            assert not owner.execute("SELECT has_table_privilege(%s, %s, 'DELETE')",
                                     (role, schema + ".ledger")).fetchone()[0]

        with psycopg.connect(url, autocommit=True) as owner:
            owner.execute(psycopg.sql.SQL("CREATE TABLE {} (id text)").format(
                psycopg.sql.Identifier(schema, "unreviewed_table")))
        with pytest.raises(RuntimeError, match="Database tables differ"):
            migrate(url, schema, role)
    finally:
        with psycopg.connect(url, autocommit=True) as owner:
            owner.execute(psycopg.sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(namespace))
            owner.execute(psycopg.sql.SQL("DROP ROLE IF EXISTS {}").format(runtime_role))
