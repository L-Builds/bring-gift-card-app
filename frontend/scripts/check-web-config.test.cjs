const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBackendUrl, validateGoogleUrl } = require("../config/public-env");
test("normalizes staging origin and retains a custom port", () => {
  assert.equal(normalizeBackendUrl(" https://api.staging.test:8443/// ", {deployed:true}), "https://api.staging.test:8443");
});
test("rejects a missing origin instead of producing a broken browser bundle", () => {
  for (const value of [undefined, "", "  "]) assert.throws(() => normalizeBackendUrl(value), /required/);
});
test("rejects accidental API suffix, URL credentials, query and fragment", () => {
  for (const value of ["https://api.test/api", "https://api.test/nested", "https://name:secret@api.test", "https://api.test?x=1", "https://api.test#x", "ftp://api.test", "/api"]) assert.throws(() => normalizeBackendUrl(value));
});
test("Vercel requires external HTTPS; local development remains possible", () => {
  for (const value of ["http://api.test", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://app.localhost"]) assert.throws(() => normalizeBackendUrl(value, {deployed:true}));
  assert.equal(normalizeBackendUrl("http://127.0.0.1:8000/"), "http://127.0.0.1:8000");
});
test("optional Google bridge is blank or a valid URL", () => {
  validateGoogleUrl(""); validateGoogleUrl("https://auth.staging.test/login", {deployed:true});
  for (const value of ["http://auth.test", "invalid", "https://user:secret@auth.test", "https://auth.test?redirect=x"]) assert.throws(() => validateGoogleUrl(value, {deployed:true}));
});
