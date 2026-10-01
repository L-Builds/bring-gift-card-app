const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function pngSize(filename) {
  const png = fs.readFileSync(path.join(root, "public", filename));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("admin install manifest has real approved-size icons and a standalone scope", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "manifest.json"), "utf8"));
  assert.equal(manifest.start_url, "/admin");
  assert.equal(manifest.scope, "/admin");
  assert.equal(manifest.name, "Bring Gift Card Admin");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    const filename = path.basename(icon.src);
    const [width, height] = pngSize(filename);
    assert.equal(`${width}x${height}`, icon.sizes);
  }
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
});

test("single-page Expo template carries the approved input focus fix", () => {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(html, /rel="manifest" href="\/manifest\.json"/);
  assert.match(html, /input:focus,/);
  assert.match(html, /outline: none !important;/);
  assert.match(html, /:focus-visible/);
});

test("service worker never intercepts authenticated or API requests", () => {
  const handlers = {};
  const worker = {
    location: { origin: "https://bring-gift-card-app.vercel.app" },
    addEventListener: (name, handler) => { handlers[name] = handler; },
  };
  const code = fs.readFileSync(path.join(root, "public", "sw.js"), "utf8");
  vm.runInNewContext(code, { self: worker, URL, caches: { match: () => Promise.resolve({}) } });
  const intercepted = request => {
    let called = false;
    handlers.fetch({ request, respondWith: () => { called = true; } });
    return called;
  };
  const request = (url, authorization = false) => ({
    method: "GET", url, mode: "same-origin",
    headers: { has: key => authorization && key === "authorization" },
  });
  assert.equal(intercepted(request("https://bring-gift-card-app.vercel.app/api/auth/me")), false);
  assert.equal(intercepted(request("https://bring-gift-card-app.vercel.app/api/admin/trades")), false);
  assert.equal(intercepted(request("https://bring-gift-card-api.vercel.app/api/admin/staff")), false);
  assert.equal(intercepted(request("https://bring-gift-card-app.vercel.app/_expo/static/js/web/app.js", true)), false);
  assert.equal(intercepted(request("https://bring-gift-card-app.vercel.app/_expo/static/js/web/app.js")), true);
});

test("admin install hook tracks standalone display mode and installed events", () => {
  const source = fs.readFileSync(path.join(root, "src", "components", "web-pwa.tsx"), "utf8");
  assert.match(source, /display-mode: standalone/);
  assert.match(source, /appinstalled/);
  assert.match(source, /isInstalled/);
});
