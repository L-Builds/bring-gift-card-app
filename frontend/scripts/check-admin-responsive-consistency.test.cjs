const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("admin shell keeps desktop primary navigation with tablet and phone drawer fallback", () => {
  const source = read("app/admin/_layout.tsx");
  assert.match(source, /const desktop = width >= 1024/);
  assert.match(source, /const compact = width < 800/);
  assert.match(source, /\{desktop && sidebar\}/);
  assert.match(source, /!desktop && <Pressable[\s\S]*admin-menu-open/);
  assert.match(source, /drawerOpen && <View/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /setTopMenu\(null\)/);
});

test("trade review stays visible on desktop and safely collapses on mobile", () => {
  const source = read("app/admin/trade/[id].tsx");
  assert.match(source, /const desktopWorkspace = viewportWidth >= 1024/);
  assert.match(source, /desktopWorkspace && Platform\.OS === "web" && styles\.reviewColumnSticky/);
  assert.match(source, /reviewColumnSticky: \{ position: "sticky" as any, top: spacing\.lg \}/);
  assert.match(source, /reviewColumnMobile: \{ width: "100%", position: "relative" \}/);
  assert.match(source, /keyboardShouldPersistTaps="handled"/);
});

test("keyboard-sensitive admin sheets avoid mobile keyboards", () => {
  for (const file of ["app/admin/trade/[id].tsx", "app/admin/kyc/[id].tsx", "app/admin/withdrawals.tsx"]) {
    const source = read(file);
    assert.match(source, /KeyboardAvoidingView/);
    assert.match(source, /Platform\.OS === "ios" \? "padding" : Platform\.OS === "android" \? "height" : undefined/);
  }
});

test("trade evidence viewer remains responsive and private", () => {
  const source = read("app/admin/trade/[id].tsx");
  assert.match(source, /viewerStageWidth = Math\.max\(260, Math\.min\(viewportWidth - \(viewportWidth >= 768 \? 120 : 24\), 1400\)\)/);
  assert.match(source, /viewerStageHeight = Math\.max\(220, viewportHeight - \(viewportWidth >= 768 \? 210 : 300\)\)/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /contentFit="contain"/);
});

test("global web focus fix keeps text inputs clean without a second focus rectangle", () => {
  const html = read("public/index.html");
  assert.match(html, /input:focus,[\s\S]*outline: none !important;/);
  assert.doesNotMatch(html, /div:has\(> :is\(input, textarea\):focus-visible/);
  assert.doesNotMatch(html, /div:has\(> input:focus-visible\[data-testid\^="admin-"/);
});

test("connectivity refresh install notifications and role navigation remain consistent", () => {
  const connection = read("src/components/admin-connectivity.tsx");
  const query = read("src/query-client.ts");
  const pwa = read("src/components/web-pwa.tsx");
  const preferences = read("src/lib/admin-preferences.ts");
  const access = read("src/lib/staff-access.ts");
  const layout = read("app/admin/_layout.tsx");

  assert.match(connection, /window\.addEventListener\("offline"/);
  assert.match(connection, /window\.addEventListener\("online"/);
  assert.match(connection, /refreshNow/);
  assert.match(connection, /30000/);
  assert.match(query, /refetchInterval: 15000/);
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /navigator\.serviceWorker\.register\("\/sw\.js", \{ scope: "\/admin" \}\)/);
  assert.match(preferences, /Notification\.requestPermission/);
  assert.match(preferences, /new Notification/);
  assert.match(access, /user\.staff_role !== "worker"/);
  assert.match(access, /staff_permissions\?\.includes\(scope\)/);
  assert.match(layout, /item\.visible\(user\)/);
});

test("customer app routes remain outside the admin responsiveness pass", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["check:web"].includes("check-admin-responsive-consistency.test.cjs"));
});
