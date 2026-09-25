# Frontend

Use Node 22 and npm ci. Copy .env.example to .env locally; set EXPO_PUBLIC_BACKEND_URL to the API origin (without /api). Never put provider/API secrets in EXPO_PUBLIC_* values. Run npm run typecheck and npm run build:web. Publish dist with SPA fallback to index.html; vercel.json provides this when the project root is this folder.

Only package-lock.json is current. Dependency overrides patch uuid/image-size and use upstream decode-uri-component 0.5.0 with only its export syntax changed to CommonJS for query-string 7 compatibility. See vendor/decode-uri-component/README.md and its MIT license. Verify the override when upgrading Expo Router.

Read ../DEPLOYMENT.md for complete setup and launch acceptance. Native builds have not been produced.
