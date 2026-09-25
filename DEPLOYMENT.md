# Bring Gift Card v1.1.0 — deployment and operations

This is a prepared source release, not a deployed service. Read `../PROJECT BRAIN/verification/latest-test-result.md` for the exact checks performed. Actual company rates, legal text and live service credentials are deliberately absent.

## 1. Prepare infrastructure

- Python 3.11 API host; MongoDB replica set/Atlas with TLS, a dedicated database user and backups. Standalone MongoDB cannot provide the required money transactions and is rejected at startup.
- Node 22 build environment and HTTPS static web host. The supplied frontend `vercel.json` uses SPA routing; set the hosting project root to `BRING GIFT CARD/frontend`.
- Private S3 bucket with public access blocked, encryption and a least-privilege API role for the `bring-gift-card/uploads/` prefix. Use a managed role where possible. A custom S3 endpoint must support the requested AES256 server-side encryption. The old managed storage integration remains optional.
- SMTP sender with TLS and verified sending domain. Configure SPF/DKIM/DMARC through the email provider, and test actual delivery and spam placement. No email is simulated in production.
- Restrict admin access through your deployment edge/VPN. Protect the API with HTTPS, a 13 MB request-body limit, connection/time limits and edge abuse controls. The application also throttles authentication/security POSTs using shared MongoDB counters.

## 2. Configure the API

From `backend`, create a virtual environment and install `requirements.lock.txt`. The smaller `requirements.txt` lists direct dependencies; the lock captures the tested runtime dependency versions. `requirements-dev.txt` adds the regression runner.

Use `.env.example` locally; production should inject values from a secret manager. Set:

- `APP_ENV=production`, `MONGO_URL`, `DB_NAME`, strong random `JWT_SECRET`, and `DATA_ENCRYPTION_KEY`.
- `CORS_ORIGINS` to exact HTTPS frontend origins, comma separated; no wildcard. `PUBLIC_APP_URL` to the HTTPS frontend origin used in reset links.
- S3 credentials/role, bucket and region; SMTP host, sender, TLS mode and credentials.
- Optional Google bridge URL only if you have an actual trusted integration. New customers must first choose a market and accept legal terms through signup. Google sign-in can then access an existing account. Apple sign-in is unavailable.

Generate secrets in your secured operator terminal, for example:

```sh
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Back up the encryption key separately from the database. Never replace it without a decrypt/re-encrypt migration. Never put payout credentials in frontend variables or the ZIP. Disable development reset-token exposure on public hosts. Production ignores that development flag.

Start the API with `uvicorn server:app --host 0.0.0.0 --port 8000 --no-access-log --no-proxy-headers`, or build the supplied Dockerfile and inject the same secrets at runtime. The Dockerfile runs as an unprivileged user; a container image was not built in this workstation verification. `/api/health/ready` checks database connectivity; it does not prove provider/email/storage readiness.

Behind a reverse proxy, either retain no proxy headers and apply per-client throttling at the edge, or explicitly configure Uvicorn's trusted proxy IP allowlist and prevent direct public access to the origin. Do not trust arbitrary forwarded headers. With proxy headers disabled, app throttling groups requests from the same proxy IP.

## 3. First setup or existing database upgrade

For a new database:

```sh
python scripts/bootstrap_markets.py
python scripts/bootstrap_catalog.py
python scripts/create_admin.py --email YOUR_REAL_ADMIN_EMAIL
```

The password is prompted securely. No default admin exists. Market import preserves admin changes. The optional catalog imports 17 website brand names as inactive; it does not copy sample rates, remote sample imagery or credentials. Review which countries the company can actually pay, disable unavailable markets, configure card-origin restrictions and real denomination prices, then enable the supported cards.

For an existing original NGN-only database, stop all old API writers and verify a restorable backup first. Run `python scripts/migrate_v110.py` for counts only. Review those counts, then use `--apply` to add NGN metadata, encrypt legacy e-codes and register owner-scoped upload paths. Existing account balances remain NGN even if an old free-text country differs. Do not run this migration on a separately developed multi-currency system. Unique-index conflicts require investigation, never deletion of financial history. Apply twice safely; no money is created or recalculated. Retain the same encryption key on every rerun.

No live database was available for migration rehearsal. The script's local test and code review do not replace a staging restoration of your actual database. If legacy uploads use managed storage, retain that integration until an explicit object migration to S3 has completed and been checked.

## 4. Build and host the frontend

From `frontend`:

```sh
npm ci
npm run typecheck
npm run build:web
```

Set `EXPO_PUBLIC_BACKEND_URL` before building to the HTTPS API origin without `/api`. Expo embeds public variables in the bundle; changing the URL requires rebuilding. Optional `EXPO_PUBLIC_GOOGLE_AUTH_URL` needs a working trusted bridge. There are no production keys in public variables.

Deploy `dist` using the SPA rewrite rules. Deep links such as `/trade`, `/admin/catalog` and `/forgot-password?token=...` must serve `index.html`. Serve assets with their actual content types. Do not expose source maps or server environment files. The reset-link page uses a no-referrer policy in the supplied hosting headers.

Only npm/package-lock.json is current. A small vendored URL decoder is the upstream 0.5.0 algorithm with its ESM export converted to CommonJS for Expo's query-string dependency; its source and license are included. Review this override when upgrading Expo. Do not run the old environment command-guard installers; they are archived as historical scaffold files outside runtime source.

## 5. Configure company content and payouts

In Admin, publish company-approved Terms and Privacy text under Production Setup. Production signup remains closed until both exist. Add markets/cards/rates as needed. Enter a **total local payout for one card at each USD face value**; this is not a per-dollar rate. Quantity is multiplied by the server. No automatic FX estimation is provided. Country/currency precision cannot be changed after a market is created.

Under Payout Providers, enter the selected provider ID, adapter, secret and enabled status. Flutterwave also requires its dashboard webhook secret. Choose the default provider. Blank secrets preserve saved keys and saved keys are never returned to the browser. Another provider can be registered disabled, but needs a reviewed backend adapter before use.

Configure the provider webhook to `https://API_ORIGIN/api/webhooks/payouts/PROVIDER_ID`. Paystack uses its SHA512 signature; Flutterwave v3 uses the configured `verif-hash`. The handler verifies the transfer again through the provider API. Keep the company provider balance funded and configure transfer authorization/OTP settings according to the provider's account requirements. No OTP-finalization UI is implemented; an OTP/pending result stays Processing and must be handled in the provider account then reconciled.

These adapters implement NGN Nigerian bank transfers. Other currencies use Company/Manual payouts until their specific destination/transfer requirements are implemented. Bank resolution verifies the name with the selected provider. A manual destination is explicitly unverified and must be checked by the company.

The withdrawal amount is reserved once in the wallet. Processing is not proof of payment. Paystack/Flutterwave payouts settle only after verified success, failure or reversal. Manual payouts require the real bank/company payment reference when marked paid. Failed/reversed payouts receive one compensating ledger entry, preserving history.

## 6. Delayed/uncertain payout operations

Review the Processing queue regularly; this package has webhook reconciliation plus an admin Reconcile action, not an automatic scheduled reconciler. Alert through your monitoring system on stale Processing records, unavailable database/storage and provider errors. Successful webhooks may be delayed or retried.

If dispatch times out or the API restarts during the call, do not resend or manually refund it. Search the provider dashboard using the deterministic `bgc-WITHDRAWAL_ID` reference and use Reconcile. Compare destination, currency and amount. Funds remain reserved when the provider cannot verify the result. Disabling a provider blocks new sends but retains reconciliation access. Reconcile active payouts before rotating keys.

A crash immediately after the database claim but before the provider call can leave an unsent reservation. An engineer/operator must obtain authoritative provider confirmation that no transfer exists, preserve that evidence and audit the exceptional recovery. There is intentionally no one-click override that can release funds while an external transfer might still succeed. Do not delete a withdrawal, reset its reference or send a fresh transfer to “fix” uncertainty. This exceptional recovery procedure must be rehearsed and owned by the company before launch.

Back up MongoDB and encryption secrets and rehearse restore. Rollbacks must preserve financial state and keys; do not restore an old database snapshot after real payments without reconciling the external provider ledger. Use a maintenance window for the first upgrade because old writers do not use the new atomic money operations.

## 7. Verification and release acceptance

Install development dependencies and point `TEST_MONGO_URL` at a disposable local replica set. `python -m pytest` runs the focused suite using a fresh random `bgc_test_*` database and deletes only that test database. The default test URI uses replica set `bringtest` on localhost port 27028; change it to your test environment. Never point it at production. Historical old test files are retained but are not selected by pytest.ini.

Before public release, verify with your staging credentials and approved data:

1. Signup, login, market selection and legal links; email reset, expiration/reuse and old-session revocation.
2. Admin card/rate changes appearing on customer screens; disabled cards, stale quotes and currency formatting, including XAF.
3. Real private physical-card upload and e-code submission; customer isolation; need-info/reply; approve/reject; exactly one wallet credit.
4. Provider bank-account resolution; withdrawal PIN, retry and insufficient-balance behavior; manual payout/receipt; provider test-mode success, failure, timeout, duplicate webhook, delayed result and reversal.
5. Transactions, receipts, support replies/attachments, logout and account switching; confirm no other customer's data appears from caches.
6. Private-bucket policies, actual SMTP delivery, provider funding/configuration, backups/restore, operator alerts, admin access restriction and production TLS/CORS/deep links.
7. Current mobile and desktop browsers. Build and test native apps on real Android/iPhone only if that release is intended; this package has no verified native/store build.

Complete company sign-off before changing provider test keys to live keys. A green configuration checklist or passing mocked-provider tests does not replace this acceptance.

## Integration references

- https://paystack.com/docs/transfers/single-transfers/
- https://paystack.com/docs/api/transfer/
- https://paystack.com/docs/api/transfer-recipient/
- https://paystack.com/docs/api/verification/
- https://paystack.com/docs/payments/webhooks/
- https://developer.flutterwave.com/docs/nigerian-bank-account-transfer
- https://developer.flutterwave.com/docs/webhooks
- Website reference: https://github.com/L-Builds/bring/tree/582b2d3d6fc176f8198413e2737459e6915ba58b
