"""Historical NGN-only Mongo upgrade is not a PostgreSQL migration.

Run the original Mongo release upgrade before export if needed. See
NEON-MIGRATION.md and PROJECT BRAIN/history/mongo-v110-migration.py.
"""
raise SystemExit("Use scripts/migrate.py for PostgreSQL. Legacy Mongo upgrades must run with the preserved original Mongo release before export; see NEON-MIGRATION.md.")
