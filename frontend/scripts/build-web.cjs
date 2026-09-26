/* global __dirname */
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeBackendUrl, validateGoogleUrl } = require("../config/public-env");
const root = path.resolve(__dirname, "..");
process.env.NODE_ENV = "production";
// Use Expo's own dotenv precedence; dashboard/shell values take precedence over files.
const expoRoot = path.dirname(require.resolve("expo/package.json"));
const expoEnv = require(require.resolve("@expo/env", { paths: [expoRoot] }));
expoEnv.loadProjectEnv(root, { mode: "production", silent: true });
try {
  const options = { deployed: process.env.VERCEL === "1" || process.env.VERCEL === "true" };
  process.env.EXPO_PUBLIC_BACKEND_URL = normalizeBackendUrl(process.env.EXPO_PUBLIC_BACKEND_URL, options);
  validateGoogleUrl(process.env.EXPO_PUBLIC_GOOGLE_AUTH_URL, options);
  if (process.env.EXPO_NO_CLIENT_ENV_VARS === "1") throw new Error("EXPO_NO_CLIENT_ENV_VARS=1 prevents Expo from embedding the configured API URL. Unset it for this app.");
} catch (error) {
  console.error(`Web configuration error: ${error.message}`);
  process.exit(1);
}
console.log(`Web API origin: ${process.env.EXPO_PUBLIC_BACKEND_URL}`);
const result = spawnSync(process.execPath, [path.join(expoRoot, "bin", "cli"), "export", "--platform", "web", ...process.argv.slice(2)], {
  cwd: root, env: process.env, stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
