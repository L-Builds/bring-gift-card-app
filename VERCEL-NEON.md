# Vercel + Neon deployment

This release uses two Vercel projects from one Git repository: the Expo web frontend and the existing FastAPI backend. PostgreSQL is the only API database. UI, financial rules, providers and original API contracts are retained. Private object storage and SMTP remain required integrations; neither Vercel's filesystem nor PostgreSQL replaces permanent image storage.

## 1. Prepare Neon before deploying the backend

Create a separate staging Neon branch/database (PostgreSQL 16 or newer). Keep it separate from production. Choose a region near the backend function region. Copy both connection strings from Neon's Connect dialog:

- **Pooled** hostname containing `-pooler`: backend `DATABASE_URL`.
- **Direct** hostname: local/CI `DATABASE_URL_UNPOOLED`, for schema migrations and imports.

Keep `sslmode=require` (or stronger) on both. Do not put either in frontend variables, Git, screenshots or browser code. Use an owner role for migrations and a dedicated non-owner runtime role for the API. After migrations, grant runtime USAGE on the schema, SELECT/INSERT/UPDATE/DELETE on application tables, and SELECT on `schema_migrations`; revoke UPDATE/DELETE on `ledger` and all write privileges on `schema_migrations`. The runtime role must not own tables or have schema CREATE privileges. Trigger checks additionally protect normal ledger writes.

From `backend`, with Python 3.12:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
# Set DATABASE_URL_UNPOOLED privately in this shell (or a local ignored .env).
# APP_ENV=production enforces TLS. DATABASE_SCHEMA defaults to public.
python scripts/migrate.py
```

Migrations run once per database, outside Vercel builds/cold starts. They are transactional and checksum-verified. Do not edit an applied SQL file; add another migration. Existing Mongo data: follow `NEON-MIGRATION.md` before bootstrapping anything. An import requires an empty target.

For a **new empty staging database only**, set `DATABASE_URL` and the backend variables below, then run:

```powershell
python scripts/bootstrap_markets.py
python scripts/bootstrap_catalog.py
python scripts/create_admin.py --email your-admin@example.com
```

The admin password is prompted. Brands start inactive, no rates or balances are invented, and startup never creates an admin. Configure approved legal text, actual denomination rates and provider sandbox keys in Admin.

## 2. Upload the source and choose the right project roots

Commit source, lockfiles, vendor files, migrations and configuration; exclude `.env`, credentials, exports, `node_modules`, virtualenvs and local test data.

| What GitHub shows at its root | Backend Root Directory | Frontend Root Directory |
|---|---|---|
| `backend/` and `frontend/` | `backend` | `frontend` |
| `BRING GIFT CARD/` and `PROJECT BRAIN/` | `BRING GIFT CARD/backend` | `BRING GIFT CARD/frontend` |

The selected backend root must directly contain `server.py`, `requirements.txt`, `.python-version` and its `vercel.json`. The frontend root must directly contain `package.json`, `package-lock.json`, `vendor/` and its own `vercel.json`. Selecting the parent folder can produce a fast deployment with a 404 and no web build.

## 3. Create the backend Vercel project

Import the repository, select the backend root above and the **FastAPI** framework. Use Python **3.12** as checked in. Keep framework build/output defaults; do not use the frontend's `dist` or npm build commands here. Vercel discovers `server.py:app`. The backend configuration sets a 300-second maximum function duration and an hourly cleanup cron. Hourly cron requires a plan supporting that frequency; the supplied schedule is intended for Pro. On Hobby, change it to a permitted daily schedule before deploying. Token/session expiry is checked on use regardless of cleanup frequency.

Set these in backend Project Settings → Environment Variables for the intended Preview/Production environment:

| Variable | Value / purpose |
|---|---|
| `APP_ENV` | `production`, including hosted staging, to enforce production security |
| `DATABASE_URL` | Neon pooled runtime-role URL, with TLS |
| `DATABASE_SCHEMA` | `public`, or the same schema used by the migration |
| `JWT_SECRET` | Random secret of at least 32 characters; preserve existing value during migration |
| `DATA_ENCRYPTION_KEY` | Fernet key; preserve exactly or old gift codes/provider secrets cannot be decrypted |
| `CORS_ORIGINS` | Exact frontend HTTPS origin(s), comma-separated; no wildcard |
| `PUBLIC_APP_URL` | Frontend HTTPS origin, used in reset emails |
| `CRON_SECRET` | Separate random secret of at least 32 characters; Vercel supplies it as Bearer auth to cron |
| `S3_BUCKET`, `AWS_REGION` | Private bucket and its region |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Restricted storage credentials, or an equivalent configured AWS identity |
| `S3_ENDPOINT_URL` | Optional S3-compatible endpoint; blank for AWS S3 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Real email delivery; generally port 587 |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` | Email auth; `false` uses STARTTLS, `true` uses implicit TLS (usually 465) |
| `GOOGLE_AUTH_SESSION_URL` | Optional existing trusted Google-session bridge; set only if used |
| `OBJECT_STORAGE_BASE_URL`, `OBJECT_STORAGE_INTEGRATION_KEY` | Alternative existing private storage integration if used instead of S3 |
| `EXPOSE_DEV_RESET_TOKEN` | `false`; production ignores the development token option |

`DATABASE_URL_UNPOOLED` belongs in the local/CI migration secret store, not the frontend and normally not the backend function environment. Payout API/webhook secrets remain encrypted in the database through authenticated Admin → Payout Providers. Existing adapters and webhook routes are unchanged.

Deploy. Check `https://YOUR-BACKEND.vercel.app/api/health/ready`; a schema/connection failure must be resolved before testing the frontend. Once the backend release with the root redirect is deployed, visiting `https://bring-gift-card-api.vercel.app/` opens the production web app. API requests still use `/api/*`.

## 4. Create/configure the frontend Vercel project

Select the frontend root above, framework **Other**, Node **22.x**. Let the checked-in config supply:

- Install: `npm ci`
- Build: `npm run build:web`
- Output: `dist`

The production web build needs no `EXPO_PUBLIC_BACKEND_URL`. It calls `/api` on its own origin. The first rewrite in `frontend/vercel.json` forwards `/api/*` to `https://bring-gift-card-api.vercel.app/api/*` only for the canonical production host `bring-gift-card-app.vercel.app`. Preview hosts have no `/api` rewrite and return 404 for that path, so Preview builds cannot write to the production API through the app's same-origin proxy. If the backend or canonical production domain changes, update the destination or host condition and redeploy the frontend. Other production aliases also need an explicit host condition before their API calls will work. Local Expo development and native builds still use `EXPO_PUBLIC_BACKEND_URL` from `frontend/.env.example`. Set the optional Google browser bridge variable only when that integration is configured. Never add backend secrets as `EXPO_PUBLIC_*` variables.

Set the backend's CORS and reset-link URL to the frontend's actual stable domain, then redeploy the backend. Prefer stable domains over a wildcard for arbitrary preview URLs. Preview can be used for read-only UI checks. Set up a separate staging API, database branch and environment-specific routing before testing Preview flows that need an API. Deployment Protection must allow the browser to reach the API; an intercepted login page is not a CORS/API response. Provider webhook testing also needs a reachable backend endpoint.

The frontend's SPA rewrite handles direct navigation and refresh on nested routes. Keep the `/api` proxy before the SPA fallback. Assets and `/api` are excluded from that fallback.

## 5. Hosted acceptance before real users

Check signup/login/logout, reset email, legal acceptance, admin authorization, configured markets/rates, trade submission/review, private images, support replies and wallet history. KYC is explicitly deferred in v1.1.0. Test refresh on `/login`, `/rates`, `/wallet`, a trade detail and an admin detail URL. Test a file larger than 4.5 MB: the client uses authenticated 3 MiB chunks, preserves the 12 MiB source limit and reads private images in bounded ranges. Final image validation/re-encoding and storage permissions stay the same. Old multipart API clients sending more than Vercel's gateway limit must use the new chunk transport or update to this client.

Use provider sandbox accounts to test dispatch, authenticated webhooks, reconciliation and reversal. Confirm one debit/credit per operation and correct retry behavior. Test SMTP delivery and private S3 permissions with real staging credentials. Cron runs on production deployments; manually call the protected cleanup endpoint for previews when needed.

Local tests do not prove Vercel/Neon network configuration, provider connectivity or capacity for millions of simultaneous users. Measure staging concurrency, latency, database connections and provider limits before choosing capacity. Financial operations deliberately serialize per wallet; different wallets can proceed concurrently. No live provider transfer has been verified for this release.

Sources checked for this release: [Vercel FastAPI](https://vercel.com/docs/frameworks/backend/fastapi), [Python runtime](https://vercel.com/docs/functions/runtimes/python), [function payload limits](https://vercel.com/docs/functions/limitations), [Neon pooling](https://neon.com/docs/connect/connection-pooling).
