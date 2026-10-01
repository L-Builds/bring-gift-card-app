const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("catalog uses a desktop management table and editable card workspace", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /testID="catalog-desktop-table"/);
  assert.match(source, />Logo</);
  assert.match(source, />Card</);
  assert.match(source, />Category</);
  assert.match(source, />Active</);
  assert.match(source, />Popular</);
  assert.match(source, /testID="catalog-card-editor"/);
  assert.match(source, /"Edit Gift Card"/);
  assert.match(source, /Current Logo/);
  assert.match(source, /catalog-logo-replace/);
  assert.match(source, /catalog-logo-remove/);
  assert.match(source, /Save Changes/);
  assert.match(source, /\/admin\/brands/);
  assert.match(source, /uploadBrandLogo/);
});

test("rates present the existing brand to market to value to payout workflow without changing rate endpoints", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /testID="admin-rates-workspace"/);
  assert.match(source, />1\. Brand</);
  assert.match(source, />2\. Market</);
  assert.match(source, />3\. Card type \/ value</);
  assert.match(source, />4\. Payout</);
  assert.match(source, /Rate setup · Brand → Market → Card type\/value → Payout/);
  assert.match(source, /\/admin\/card-rates/);
  assert.match(source, /face_value, payout_minor, is_active: true/);
  assert.match(source, /Rate is saved|rate model is preserved|existing rate model is preserved/i);
  assert.match(source, /testID="rates-desktop-table"/);
});

test("markets use a desktop table plus add/edit panel while preserving the existing market endpoint", () => {
  const source = read("app/admin/markets.tsx");
  assert.match(source, /testID="admin-markets-workspace"/);
  assert.match(source, /testID="markets-desktop-table"/);
  assert.match(source, />Country</);
  assert.match(source, />Currency</);
  assert.match(source, />Decimals</);
  assert.match(source, />Status</);
  assert.match(source, /testID="market-editor-panel"/);
  assert.match(source, /editable=\{!editing\}/);
  assert.match(source, /api\.post\("\/admin\/markets", form\)/);
});

test("staff clearly shows roles permissions and status while preserving staff permission endpoints", () => {
  const source = read("app/admin/staff.tsx");
  assert.match(source, /testID="staff-role-summary"/);
  assert.match(source, /General Manager/);
  assert.match(source, /Managers/);
  assert.match(source, /Workers/);
  assert.match(source, /testID="staff-desktop-table"/);
  assert.match(source, />Assigned Permissions</);
  assert.match(source, />Status</);
  assert.match(source, /STAFF_SCOPES\.map/);
  assert.match(source, /api\.post\("\/admin\/staff"/);
  assert.match(source, /api\.patch\(`\/admin\/staff\/\$\{id\}`/);
  assert.match(source, /isGeneralManager \? member\.staff_role !== "general_manager" : member\.staff_role === "worker"/);
});

test("worker management access source of truth remains unchanged", () => {
  const source = read("src/lib/staff-access.ts");
  assert.match(source, /return user\?\.role === "admin" && user\.staff_role !== "worker"/);
  assert.match(source, /return user\.staff_role !== "worker" \|\| !!user\.staff_permissions\?\.includes\(scope\)/);
});
