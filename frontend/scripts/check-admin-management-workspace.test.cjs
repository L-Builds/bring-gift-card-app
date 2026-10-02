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

test("rates use the card-specific detailed country workspace", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /testID="admin-rates-workspace"/);
  assert.match(source, /testID="rate-card-selector"/);
  assert.match(source, /testID="rate-market-selector"/);
  assert.match(source, /testID="detailed-rate-workspace"/);
  assert.match(source, />Detailed Card Rates</);
  assert.match(source, />Countries</);
  assert.match(source, /testID="detailed-country-add"/);
  assert.match(source, />Physical</);
  assert.match(source, />Code</);
  assert.match(source, />Rate per unit</);
  assert.match(source, /testID="detailed-physical-rate"/);
  assert.match(source, /testID="detailed-code-rate"/);
  assert.match(source, /\/admin\/detailed-rates\/country/);
  assert.match(source, /Disable Country/);
  assert.match(source, /Remove Country/);
  assert.doesNotMatch(source, /Total trade range from \(optional\)/);
  assert.doesNotMatch(source, /Card value \(USD\)/);
  assert.doesNotMatch(source, /\/admin\/card-rates/);
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
