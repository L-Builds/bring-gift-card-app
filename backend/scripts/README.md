# Operator scripts

Run from backend using Python 3.12 and privately configured environment variables. Read ../../VERCEL-NEON.md and ../../NEON-MIGRATION.md.

1. `python scripts/migrate.py`: transactional, checksum-verified PostgreSQL schema migrations via `DATABASE_URL_UNPOOLED`. Set `BGC_RUNTIME_ROLE` to the existing non-owner API role name. Production migrations require it; the command reconciles and verifies table grants after every run. New runtime tables and sequences require an explicit policy entry in `scripts/runtime_grants.py`.
2. `python scripts/export_mongo.py --output PRIVATE_NEW_DIRECTORY`: offline read-only exporter; optional pymongo dependency in a separate environment.
3. `python scripts/import_snapshot.py PRIVATE_DIRECTORY`: full verified dry run, rolled back. Add --apply only for the intended empty target.
4. `python scripts/bootstrap_markets.py`: missing website markets only, preserving admin changes. For new databases, not before importing.
5. `python scripts/bootstrap_catalog.py`: optional inactive brand names, no sample rates.
6. `python scripts/create_admin.py --email YOUR_EMAIL`: create the one General Manager after migrations. The password is prompted and must be 12–72 UTF-8 bytes and end in `@admin`. No admin account is created automatically. Do not put the password in Git, Vercel variables, or command history.The General Manager signs in at the normal `/login` page and opens `/admin`. In Admin → Staff, the General Manager can create Managers and Workers. Managers can create and manage Workers. Workers receive explicit assignments for trades, withdrawals, support, and/or customers; the API denies all unassigned work and management settings. Admin passwords, including passwords set during staff creation or reset, must end in `@admin`; the server checks this at login.

The old Mongo v1.1.0 upgrader is preserved in PROJECT BRAIN/history and must run with the original Mongo release before export when necessary. It is not a PostgreSQL migration. Runtime/bootstrap/admin scripts use PostgreSQL only.
