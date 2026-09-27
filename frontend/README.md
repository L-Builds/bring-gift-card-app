> **Vercel web testing:** follow [the deployment guide](../VERCEL-DEPLOYMENT.md). This is the current frontend deployment procedure; the backend now also targets Vercel and Neon; see ../VERCEL-NEON.md.

# Frontend

Use Node 22 and npm ci. For local Expo development and native builds, copy .env.example to .env and set EXPO_PUBLIC_BACKEND_URL to the API origin (without /api). The production web build uses same-origin /api requests and needs no backend URL environment variable; frontend/vercel.json forwards those requests to the Bring API. Never put provider/API secrets in EXPO_PUBLIC_* values. Run npm run typecheck and npm run build:web. Publish dist with SPA fallback to index.html; vercel.json provides this when the project root is this folder.

Only package-lock.json is current. Dependency overrides patch uuid/image-size and use upstream decode-uri-component 0.5.0 with only its export syntax changed to CommonJS for query-string 7 compatibility. See vendor/decode-uri-component/README.md and its MIT license. Verify the override when upgrading Expo Router.

Read ../DEPLOYMENT.md for complete setup and launch acceptance. Native builds have not been produced.

Transport checks: `node --test scripts/check-file-transport.test.cjs`.
