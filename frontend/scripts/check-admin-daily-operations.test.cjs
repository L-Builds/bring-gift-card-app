const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("trade queue is a searchable, filterable desktop table with details navigation", () => {
  const source = read("app/admin/trades.tsx");
  assert.match(source, /admin-trade-search/);
  assert.match(source, /admin-trade-sort-\$\{option\.key\}/);
  assert.match(source, /admin-filter-\$\{f\.key\}/);
  assert.match(source, />Expected payout</);
  assert.match(source, /router\.push\(`\/admin\/trade\/\$\{item\.id\}`\)/);
  assert.match(source, /QueryErrorView title="Trade queue unavailable"/);
});

test("withdrawals use a compact desktop table while preserving financial actions", () => {
  const source = read("app/admin/withdrawals.tsx");
  assert.match(source, /admin-withdrawal-search/);
  assert.match(source, /admin-wd-sort-\$\{option\.key\}/);
  assert.match(source, />Destination</);
  assert.match(source, />Actions</);
  assert.match(source, /\/admin\/withdrawals\/\$\{id\}\/\$\{path\}/);
  assert.match(source, /\/admin\/withdrawals\/\$\{rejectId\}\/reject/);
  assert.match(source, /\/admin\/withdrawals\/\$\{paidItem\.id\}\/paid/);
  assert.match(source, /wd-process-/);
  assert.match(source, /wd-reconcile-/);
});

test("customers expose search, verification filters, sorting and row-to-detail navigation", () => {
  const source = read("app/admin/customers.tsx");
  assert.match(source, /admin-customer-search/);
  assert.match(source, /admin-customer-kyc-\$\{option\.key\}/);
  assert.match(source, /admin-customer-sort-\$\{option\.key\}/);
  assert.match(source, />Verification</);
  assert.match(source, /router\.push\(`\/admin\/customer\/\$\{item\.id\}`\)/);
  assert.match(source, /QueryErrorView title="Customers unavailable"/);
});

test("verification queue is searchable, filterable, sortable and opens existing review details", () => {
  const source = read("app/admin/kyc.tsx");
  assert.match(source, /admin-kyc-search/);
  assert.match(source, /admin-kyc-filter-\$\{f\.key\}/);
  assert.match(source, /admin-kyc-sort-\$\{option\.key\}/);
  assert.match(source, />Document</);
  assert.match(source, /router\.push\(`\/admin\/kyc\/\$\{item\.id\}`\)/);
  assert.match(source, /QueryErrorView title="Verification queue unavailable"/);
});

test("support inbox keeps existing search/status behavior and adds compact sorting", () => {
  const source = read("app/admin/support.tsx");
  assert.match(source, /admin-support-search/);
  assert.match(source, /admin-support-filter-\$\{f\.key\}/);
  assert.match(source, /admin-support-sort-\$\{option\.key\}/);
  assert.match(source, />Latest message</);
  assert.match(source, /router\.push\(`\/admin\/support\/\$\{item\.id\}`\)/);
  assert.match(source, /QueryErrorView title="Support inbox unavailable"/);
});
