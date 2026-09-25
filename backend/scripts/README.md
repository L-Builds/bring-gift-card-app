# Operator scripts

Run from backend with its virtual environment and .env or secret-manager variables configured.

1. python scripts/bootstrap_markets.py — inserts missing website market definitions, preserves existing admin edits; no rates or users.
2. python scripts/bootstrap_catalog.py — optional website brand names inserted inactive; no prices or invented card-origin restrictions.
3. python scripts/create_admin.py --email YOUR_EMAIL — securely prompts for the first admin password; creates no account automatically. Prefer the prompt over a password CLI argument/history.
4. python scripts/migrate_v110.py — read-only count report for an existing legacy NGN-only database. Back up and stop all writers before --apply. Adds currency metadata, encrypts old codes and registers owner-scoped uploaded paths. Does not recalculate money or import rates. Inspect duplicates if unique-index creation fails; do not delete ledger history to make indexes pass.

Scripts require real configuration and are not automatic startup hooks. Read ../../DEPLOYMENT.md before use.
