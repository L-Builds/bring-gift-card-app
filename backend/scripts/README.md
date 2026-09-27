# Operator scripts

Run from backend using Python 3.12 and privately configured environment variables. Read ../../VERCEL-NEON.md and ../../NEON-MIGRATION.md.

1. `python scripts/migrate.py`: transactional, checksum-verified PostgreSQL schema migrations via DATABASE_URL_UNPOOLED.
2. `python scripts/export_mongo.py --output PRIVATE_NEW_DIRECTORY`: offline read-only exporter; optional pymongo dependency in a separate environment.
3. `python scripts/import_snapshot.py PRIVATE_DIRECTORY`: full verified dry run, rolled back. Add --apply only for the intended empty target.
4. `python scripts/bootstrap_markets.py`: missing website markets only, preserving admin changes. For new databases, not before importing.
5. `python scripts/bootstrap_catalog.py`: optional inactive brand names, no sample rates.
6. `python scripts/create_admin.py --email YOUR_EMAIL`: prompt for password, no automatic account creation.

The old Mongo v1.1.0 upgrader is preserved in PROJECT BRAIN/history and must run with the original Mongo release before export when necessary. It is not a PostgreSQL migration. Runtime/bootstrap/admin scripts use PostgreSQL only.
