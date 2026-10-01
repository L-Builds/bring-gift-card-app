const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("admin shell keeps desktop-first layout with mobile drawer fallback", () => {
  const source = read("app/admin/_layout.tsx");
  assert.match(source, /const desktop = width >= 1024/);
  assert.match(source, /const compact = width < 800/);
  assert.match(source, /\{desktop && sidebar\}/);
  assert.match(source, /admin-menu-open/);
  assert.match(source, /drawerOpen/);
});

test("settings stay responsive and company configuration stays management-only", () => {
  const settings = read("app/admin/settings.tsx");
  const access = read("src/lib/staff-access.ts");
  assert.match(settings, /const twoColumns = width >= 900/);
  assert.match(settings, /Company Configuration/);
  assert.match(settings, /\{management && <View/);
  assert.match(access, /user\.staff_role !== "worker"/);
  assert.match(access, /route === "settings"/);
});

test("admin connectivity exposes automatic refresh and immediate browser network state", () => {
  const connection = read("src/components/admin-connectivity.tsx");
  const queryClient = read("src/query-client.ts");
  assert.match(connection, /window\.addEventListener\("offline"/);
  assert.match(connection, /window\.addEventListener\("online"/);
  assert.match(connection, /30000/);
  assert.match(connection, /15000/);
  assert.match(queryClient, /refetchInterval: 15000/);
});

test("admin PWA remains scoped to the private admin workspace", () => {
  const manifest = JSON.parse(read("public/manifest.json"));
  const pwa = read("src/components/web-pwa.tsx");
  assert.equal(manifest.start_url, "/admin");
  assert.equal(manifest.scope, "/admin");
  assert.equal(manifest.display, "standalone");
  assert.match(pwa, /!isAdmin \|\| !isAdminArea/);
  assert.match(pwa, /navigator\.serviceWorker\.register\("\/sw\.js", \{ scope: "\/admin" \}\)/);
});

test("password and session controls remain wired into Settings", () => {
  const settings = read("app/admin/settings.tsx");
  assert.match(settings, /\/auth\/password\/change/);
  assert.match(settings, /\/auth\/sessions\/revoke-others/);
  assert.match(settings, /Current password/);
  assert.match(settings, /end with @admin/);
});
