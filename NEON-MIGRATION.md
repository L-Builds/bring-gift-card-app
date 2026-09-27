# MongoDB → PostgreSQL cutover

The running API now uses SQLAlchemy + psycopg and PostgreSQL only. Original Mongo source and the prior release ZIP are retained for rollback. `scripts/export_mongo.py` is an offline, read-only exporter with an optional pymongo dependency; it is excluded from the deployed function. Do not delete the source database during migration.

## Data and transaction design

Typed PostgreSQL columns hold financial amounts (BIGINT minor units), identity, ownership, status and indexed query fields. JSONB preserves nested snapshots, status histories and optional metadata without changing API dictionaries. All 75 original OpenAPI paths and their schemas are unchanged; three authenticated chunk-upload paths are additive. Legacy `*_kobo` field names remain integer minor units for the wallet currency.

Wallet mutations lock the user row and re-read/lock the trade or withdrawal under READ COMMITTED. Ledger entries, status, audit and notifications commit in one transaction. Database checks cover positive amounts/signs, owners/currencies, unique withdrawal request keys and unique ledger references. Ledger updates/deletes are forbidden; a deferred trigger rejects a negative committed balance. External provider calls remain outside retried money transactions. Only explicitly rolled-back deadlocks/serialization failures are retried; uncertain commits are not blindly replayed.

Runtime uses Neon's transaction pooler with no persistent SQLAlchemy pool and no prepared statement cache. Timezone/search path/timeouts are transaction-local. Schema DDL is an offline operation, never a cold-start side effect. Expired resets/counters/chunk sessions are removed by authenticated cron; expiry is still enforced at use time.

## Rehearsal

1. Back up Mongo, private image storage and encryption/JWT secrets. Inventory the exact current release. If using the old NGN-only release, run its existing v1.1.0 upgrade with that original Mongo application before exporting. Its historical script is preserved in `PROJECT BRAIN/history/mongo-v110-migration.py`; it is not a PostgreSQL migration. Never rewrite ledger currency or invent rates during transfer.
2. Create an empty disposable Neon migration branch and apply `backend/scripts/migrate.py` using its direct connection. Do not bootstrap markets/admin/rates into an import target.
3. In a separate migration virtualenv, install `pymongo==4.18.2`. Set `SOURCE_MONGO_URL` and `SOURCE_DB_NAME` privately. Mongo must support snapshot sessions (replica set, MongoDB 5+).

```powershell
python scripts/export_mongo.py --output C:\private-migration\snapshot-new
```

The destination must not exist. The exporter rejects unmapped nonempty collections and does not modify the source. It writes all 20 source collections plus counts, file checksums, order-independent record digests and per-wallet balances. Treat the export as sensitive: it contains password hashes, PII and encrypted business secrets. Keep it out of Git and Vercel.

4. In the PostgreSQL application environment, set `DATABASE_URL_UNPOOLED` to the **empty target's direct URL**, preserve the schema name, then run:

```powershell
python scripts/import_snapshot.py C:\private-migration\snapshot-new
```

Default is a full dry run: insert in dependency order (ledger last), enforce constraints, verify every record digest/count and wallet balance, then roll back. Any mismatch fails the entire transaction. No data is silently dropped, repaired or normalized into a different business value. Resolve invalid source records through a reviewed reconciliation; do not disable constraints to force import.

5. Apply the same verified export:

```powershell
python scripts/import_snapshot.py C:\private-migration\snapshot-new --apply
```

The importer locks the empty target against concurrent API writes, rejects nonempty targets and commits only after parity checks. Verify the reported counts and `balances_match: true`. Private objects remain at their existing keys; storage credentials and `DATA_ENCRYPTION_KEY` must match. Test access to old gift codes, provider credentials, sessions, attachments and histories.

## Final cutover and rollback

Schedule a write pause: stop old API writers, dispatch jobs and provider callbacks (arrange provider retries). Reconcile any in-flight payouts, then take a fresh snapshot. Rehearsal data is not a live synchronization mechanism. Import into a newly empty final target; deploy the new backend/frontend with the matching secrets and Neon URL. Re-enable traffic/callbacks only after counts, balances and staging flows pass. Do not run old and new writers in parallel.

Before new writes, rollback means point traffic back to the untouched old application/database. After PostgreSQL has accepted writes, do **not** simply switch to the stale Mongo database: pause writes and reconcile/export the new activity using a reviewed recovery procedure. This release does not implement reverse replication. Retain encrypted backups and the old release until the agreed rollback window and financial reconciliation are complete.

## Repeatable verification

From backend, Python 3.12, with an isolated PostgreSQL test database:

```powershell
python -m pip install -r requirements-dev.txt
$env:TEST_DATABASE_URL='postgresql://test-user:password@host/testdb?sslmode=require'
# If runtime URL is pooled, also set TEST_DATABASE_URL_UNPOOLED to its direct URL.
python -m pytest
```

The suite creates a random `bgc_test_*` schema and removes only that schema. Use a disposable database/user authorized to create schemas, never production. The 26 existing production assertions are retained and supplemented with SQL/concurrency/transport tests. Older phase tests remain historical and are excluded by the existing default suite configuration; they contain pre-production contract assumptions.

To separately prove the offline exporter, install `pymongo==4.18.2` into a **migration test** environment with the dev requirements, set `TEST_MONGO_URL` to a disposable replica set, and run `python -m pytest tests/test_migration.py`. That test creates/deletes only uniquely named test databases, verifies a real Mongo export, dry-run rollback, applied parity, digest-failure rollback and nonempty-target rejection. Mongo is not needed for the normal PostgreSQL suite or runtime.
