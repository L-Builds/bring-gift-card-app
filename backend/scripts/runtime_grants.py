"""Explicit least-privilege grants for the API's non-owner PostgreSQL role.

Called by the owner-only migration command after checked-in SQL is applied.
Keep the table policy in sync with schema.TABLES so a future runtime table
cannot be introduced without a reviewed grant decision.
"""
import re
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from schema import TABLES


MUTABLE_TABLES = frozenset({
    "abuse_counters", "audit", "brands", "card_rates", "detailed_rates",
    "headline_rates", "kyc_submissions", "legal", "markets", "notifications",
    "password_resets", "payout_accounts", "payout_providers", "popular_cards",
    "rate_changes", "settings", "support_messages", "support_tickets",
    "trades", "upload_parts", "upload_sessions", "uploads", "users", "withdrawals",
})
APPEND_ONLY_TABLES = frozenset({"ledger"})
READ_ONLY_TABLES = frozenset({"schema_migrations"})
REVIEWED_TABLES = MUTABLE_TABLES | APPEND_ONLY_TABLES | READ_ONLY_TABLES
SEQUENCES_WITH_USAGE = frozenset()  # Explicitly review and list any future nextval() sequences.
ALL_TABLE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")


def _identifier(value: str, label: str) -> str:
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", value):
        raise ValueError(f"Invalid {label}")
    return value


def reconcile_runtime_grants(connection: psycopg.Connection, schema: str, role: str) -> None:
    """Apply and verify the reviewed privilege matrix in the migration transaction."""
    schema = _identifier(schema, "database schema")
    role = _identifier(role, "runtime role")
    if set(TABLES) != MUTABLE_TABLES | APPEND_ONLY_TABLES:
        raise RuntimeError("A runtime table lacks an explicit privilege policy")
    role_info = connection.execute(
        "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = %s", (role,)
    ).fetchone()
    if not role_info:
        raise RuntimeError("Configured runtime role does not exist")
    if any(role_info) or connection.execute("SELECT current_user").fetchone()[0] == role:
        raise RuntimeError("Runtime role must be a non-owner role without administrative privileges")
    if connection.execute("SELECT pg_has_role(%s, current_user, 'member')", (role,)).fetchone()[0]:
        raise RuntimeError("Runtime role must not be a member of the migration owner role")

    existing_sequences = {
        name for (name,) in connection.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = %s AND c.relkind = 'S'", (schema,)
        )
    }
    if existing_sequences != SEQUENCES_WITH_USAGE:
        raise RuntimeError("A database sequence lacks an explicit runtime privilege policy")
    existing_tables = {
        name for (name,) in connection.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = %s AND c.relkind IN ('r', 'p')", (schema,)
        )
    }
    if existing_tables != REVIEWED_TABLES:
        raise RuntimeError("Database tables differ from the reviewed runtime privilege policy: "
                           + ", ".join(sorted(existing_tables ^ REVIEWED_TABLES)))

    qualified_schema = psycopg.sql.Identifier(schema)
    runtime_role = psycopg.sql.Identifier(role)
    connection.execute(psycopg.sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(qualified_schema, runtime_role))
    connection.execute(psycopg.sql.SQL("REVOKE CREATE ON SCHEMA {} FROM {}").format(qualified_schema, runtime_role))

    permissions = {
        **{table: frozenset({"SELECT", "INSERT", "UPDATE", "DELETE"}) for table in MUTABLE_TABLES},
        **{table: frozenset({"SELECT", "INSERT"}) for table in APPEND_ONLY_TABLES},
        **{table: frozenset({"SELECT"}) for table in READ_ONLY_TABLES},
    }
    for table, allowed in permissions.items():
        qualified_table = psycopg.sql.Identifier(schema, table)
        connection.execute(psycopg.sql.SQL("REVOKE ALL PRIVILEGES ON TABLE {} FROM {}").format(
            qualified_table, runtime_role))
        connection.execute(psycopg.sql.SQL("GRANT {} ON TABLE {} TO {}").format(
            psycopg.sql.SQL(", ").join(map(psycopg.sql.SQL, sorted(allowed))),
            qualified_table, runtime_role))

    for sequence in SEQUENCES_WITH_USAGE:
        qualified_sequence = psycopg.sql.Identifier(schema, sequence)
        connection.execute(psycopg.sql.SQL("REVOKE ALL PRIVILEGES ON SEQUENCE {} FROM {}").format(
            qualified_sequence, runtime_role))
        connection.execute(psycopg.sql.SQL("GRANT USAGE ON SEQUENCE {} TO {}").format(
            qualified_sequence, runtime_role))

    if not connection.execute("SELECT has_schema_privilege(%s, %s, 'USAGE')", (role, schema)).fetchone()[0]:
        raise RuntimeError("Runtime role lacks schema USAGE")
    if connection.execute("SELECT has_schema_privilege(%s, %s, 'CREATE')", (role, schema)).fetchone()[0]:
        raise RuntimeError("Runtime role unexpectedly has schema CREATE")
    for table, allowed in permissions.items():
        qualified_name = f"{schema}.{table}"
        for privilege in ALL_TABLE_PRIVILEGES:
            actual = connection.execute("SELECT has_table_privilege(%s, %s, %s)",
                                        (role, qualified_name, privilege)).fetchone()[0]
            if actual != (privilege in allowed):
                raise RuntimeError(f"Unexpected {privilege} privilege on {qualified_name} for runtime role")
    for sequence in SEQUENCES_WITH_USAGE:
        qualified_name = f"{schema}.{sequence}"
        for privilege in ("USAGE", "SELECT", "UPDATE"):
            actual = connection.execute("SELECT has_sequence_privilege(%s, %s, %s)",
                                        (role, qualified_name, privilege)).fetchone()[0]
            if actual != (privilege == "USAGE"):
                raise RuntimeError(f"Unexpected {privilege} privilege on {qualified_name} for runtime role")
