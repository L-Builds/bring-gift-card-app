# Vercel web testing deployment

This deploys the existing Expo web app as a static single-page application. FastAPI, MongoDB and background/backend services remain on their separate host. Vercel does not deploy the backend through this frontend configuration. No screens, features or backend architecture were redesigned.

## 1. Prepare the staging backend

Use a separately hosted, reachable HTTPS staging backend with its own database and test accounts. Keep real customer data out of staging. Its readiness endpoint is `https://YOUR-STAGING-API-HOST/api/health/ready`. Complete the backend setup in `DEPLOYMENT.md`, including the replica set, encryption/authentication secrets, markets and applicable legal content. A frontend deployment cannot repair an unavailable or unconfigured backend.

Only the public API origin belongs in Vercel. MongoDB URLs, JWT/encryption secrets, payout-provider credentials, email and storage credentials belong exclusively on the backend host.

## 2. Import the source into Vercel

1. Extract the complete ZIP and put the two top-level folders in your Git repository. Commit the source, including `frontend/vendor`, `package-lock.json` and `vercel.json`. Do not commit local `.env`, `node_modules`, `dist` or `.vercel`.
2. In Vercel choose **Add New > Project**, then import that repository. Use a dedicated staging project, for example a name of your choice ending in `-staging`.
3. **Leave Root Directory at the repository root (blank/default).** This release now includes a repository-root Vercel wrapper, so Vercel can build the nested Expo frontend without manual folder selection. For compatibility, equivalent wrappers also exist inside `BRING GIFT CARD/`, while `BRING GIFT CARD/frontend/` remains directly deployable on its own.
4. Set **Framework Preset** to **Other** and **Node.js Version** to **22.x** if Vercel does not pick them from the committed configuration. The repository-root configuration installs the frontend with `npm --prefix "BRING GIFT CARD/frontend" ci`, builds with `npm --prefix "BRING GIFT CARD/frontend" run build:web`, and publishes `BRING GIFT CARD/frontend/dist`. Remove conflicting dashboard overrides. Leave automatic exposure of Vercel system environment variables enabled; the build uses `VERCEL` to enforce HTTPS deployment configuration.
5. Before clicking Deploy, add the environment variables below to both **Preview** and **Production** in this dedicated staging project. Vercel calls the default-branch deployment “Production” even when your project is only used for staging.

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_BACKEND_URL` | Your real HTTPS staging backend **origin**, such as `https://api-staging.your-domain.com`; no `/api`, path, query or credentials. Required. |
| `EXPO_PUBLIC_GOOGLE_AUTH_URL` | Optional existing HTTPS managed Google authentication bridge URL. Leave unset until that bridge and its redirects are configured. |

The build adds `/api` itself. These values are public and embedded into JavaScript at build time. Changing dashboard values requires a new deployment. Do not set `NODE_ENV=staging` or `EXPO_NO_CLIENT_ENV_VARS=1`. Do not promote a staging-built artifact expecting its embedded backend URL to change; rebuild with the intended environment.

6. Click **Deploy**. A successful build exports `dist/index.html` and the static bundle/assets. Missing or invalid API configuration fails the build with an actionable error.
7. Copy the project's stable staging URL from Vercel. On the **backend host**, set `CORS_ORIGINS` to the exact allowed frontend origins, comma-separated, without trailing slashes. Example: `https://YOUR-STAGING-PROJECT.vercel.app,https://staging.your-domain.com`. Use only origins you actually operate. Set `PUBLIC_APP_URL` to the stable staging frontend origin so reset links return there, then restart/redeploy the backend.
8. A generated preview URL is a different origin. Add the exact preview origin to backend `CORS_ORIGINS` when testing that deployment, or test through the stable staging alias. Do not use a wildcard; production backend configuration rejects it. Keep the existing backend production security settings (`APP_ENV=production`) on hosted staging.

## 3. Verify the deployed site

- Open Home, Login and Sign Up. Log in with a staging customer and visit Rates, Trade, Transactions, Profile and Wallet. Confirm requests in browser Network target your configured backend at `/api/...` and return JSON.
- Paste nested URLs directly into a new tab and refresh them: `/security/pin`, `/legal/terms`, `/support/tickets`, `/card/<real-brand-id>`, `/trade/<real-trade-id>`, and authorized `/admin/customer/<real-user-id>`. The Vercel rewrite loads the existing Expo router for these paths. Auth guards still apply.
- Confirm guest requests for `/wallet` and `/admin` return to Login, and customers cannot open admin pages. KYC routes retain their intentionally deferred redirects.
- Inspect failed requests and browser console. Static JS/fonts/images must load; missing `/_expo/...`, `/assets/...` and accidental frontend `/api/...` requests should return 404, not the application HTML.
- Exercise actual staging login, password reset, uploads and configured integrations. Test provider sandbox credentials and approved test amounts only. Local route tests do not establish live provider/email/storage correctness.

## Local reproduction

From `BRING GIFT CARD/frontend` with Node 22:

```powershell
npm ci
npm run check:web
npm run typecheck
$env:EXPO_PUBLIC_BACKEND_URL = 'https://YOUR-REAL-STAGING-API-HOST'
$env:VERCEL = '1'
npm run build:web
```

`npm run lint` is also available, but the inherited app has outstanding lint errors (see the verification report); it is not a build gate. Changed deployment files pass targeted lint.

Use an SPA-capable local server if previewing `dist`; Vercel uses the committed rewrite. Local development may use `http://localhost:8000` through `.env` and `npm run web`. No backend URL is hardcoded into the delivered source.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Missing API URL build failure | Add `EXPO_PUBLIC_BACKEND_URL` to the deployment's environment scope and redeploy. |
| HTTPS/origin validation failure | Use the external HTTPS origin, remove `/api`, credentials, query and fragment. |
| Page loads but API fails | Check backend readiness, DNS/TLS and exact CORS origin. Check the browser's actual request URL. |
| Old API URL remains | Trigger a fresh build with the new environment; values are compiled in. |
| Whole site returns Vercel `404 NOT_FOUND` immediately | Confirm the GitHub redeploy includes the new repository-root `vercel.json` and `package.json`. Prefer Root Directory blank/default. If the project has an old manual Root Directory override, reset it to the repository root and redeploy. |
| API call returns HTML | Ensure the configured URL points to FastAPI, not the frontend Vercel domain. |
| Protected screen returns Login | Check authentication/token expiry; this is separate from SPA rewriting. |

## Verification boundary

See `../PROJECT BRAIN/verification/VERCEL-READINESS.md` for checks executed on this release. This package is prepared for deployment; an actual Vercel deployment and real staging integration checks require your staging backend URL and hosted configuration. The `.test` hostname used in verification is a test fixture, not a service to configure.

Official references: [Expo web deployment](https://docs.expo.dev/guides/publishing-websites/), [Expo public environment variables](https://docs.expo.dev/guides/environment-variables/), [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json), [Vercel environments](https://vercel.com/docs/deployments/environments).
