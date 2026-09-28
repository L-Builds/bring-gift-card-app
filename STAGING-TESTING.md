# Isolated staging test setup

This source was tested on the following **staging-only** projects:

| Purpose | URL |
| --- | --- |
| Customer web app and login | https://bring-gift-card-app-stage.vercel.app |
| Admin login and panel | https://bring-gift-card-app-stage.vercel.app/login and `/admin` after signing in |
| API health | https://bring-gift-card-api-stage.vercel.app/api/health/ready |

The backend uses a separate Neon branch, a non-owner runtime database role, and a private staging object-storage bucket. It has an active NGN test market and one clearly named **STAGING TEST CARD** with a synthetic test rate. No production market, card, balance, or provider record was created. The test customer and admin accounts are already initialized on staging; their credentials are supplied separately to the project owner and are intentionally absent from this source archive. Do not reuse them in production.

The staging catalog is for checking navigation and financial workflow mechanics. A test trade can be submitted with an e-code or a test image. Admin approval credits the staging wallet. Withdrawal requests can be placed to a manually entered test payout account; keep them in manual review or reject them until a sandbox payout provider is configured. The stage supports private image upload and retrieval, support tickets, and admin replies. It has no live payout integration, SMTP delivery, or Google session bridge. Password-reset emails and Google sign-in therefore require those external integrations before end-to-end testing.

## Deploying this source to an existing environment

1. Point the backend at the intended database branch. Use the pooled URL for the Vercel runtime role and the direct owner URL only for migrations from a trusted local/CI environment. Keep all URLs and secrets out of the archive and frontend bundle.
2. Run `backend/scripts/migrate.py` with the direct owner URL before deploying the backend. Migration `003_referral_uniqueness.sql` checks for duplicate historical referral codes and adds a case-insensitive unique index. If duplicates exist, stop and reconcile them with the business owner. Do not drop or rewrite user records automatically. Migrations `001` and `002` and the ledger triggers remain intact.
3. Deploy the backend from `backend/` and check `/api/health/ready`. Do not rely on build-time migrations. Configure `PUBLIC_APP_URL` and `CORS_ORIGINS` for the matching frontend origin.
4. Deploy the frontend from `frontend/`. Add a host-specific `/api` rewrite for any new canonical domain, before the SPA fallback. The checked-in production and staging rewrites are for their named hosts only.
5. Activate only approved live markets, denominations, payout rates, providers, and legal text before accepting real users. The staging test catalog is not a source of live rates.

For production, the current database audit found migrations `001` and `002` but no user, market, brand, or rate records. The production database was read only during this work. Migration `003` must be applied there before deploying the new backend, and live setup requires approved market/catalog/rate and external service configuration. The isolated staging projects do not automatically change the current production projects.
