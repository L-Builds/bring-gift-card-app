// Shared by the web build preflight and the API client. Public URLs contain no secrets.
function normalizeBackendUrl(value, { deployed = false } = {}) {
  const input = (value || "").trim();
  const name = "EXPO_PUBLIC_BACKEND_URL";
  if (!input) throw new Error(`${name} is required. Set it to your staging backend origin before building.`);
  let url;
  try { url = new URL(input); } catch { throw new Error(`${name} must be an absolute http(s) origin.`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an http(s) origin without credentials, query parameters or a fragment.`);
  }
  if (url.pathname.replace(/\/+$/, "")) {
    throw new Error(`${name} must be the backend origin only, without /api or another path. The app adds /api.`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if (deployed && (url.protocol !== "https:" || local)) {
    throw new Error(`${name} must use a reachable HTTPS backend for Vercel. Localhost and HTTP are for local testing only.`);
  }
  return url.origin;
}

function validateGoogleUrl(value, { deployed = false } = {}) {
  if (!(value || "").trim()) return;
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("EXPO_PUBLIC_GOOGLE_AUTH_URL must be an absolute URL or blank."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || (deployed && url.protocol !== "https:")) {
    throw new Error("EXPO_PUBLIC_GOOGLE_AUTH_URL must be an HTTPS auth-bridge URL without credentials, query or fragment on Vercel; leave blank if unused.");
  }
}

module.exports = { normalizeBackendUrl, validateGoogleUrl };
