const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Admin Rates has one simple All Cards display editor backed by headline_rates", () => {
  const source = read("app/admin/catalog.tsx");
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  assert.match(source, /All Cards Display Rate/);
  assert.match(source, />\$1</);
  assert.match(source, /testID="headline-rate-payout"/);
  assert.match(source, /\/admin\/headline-rates/);
  assert.doesNotMatch(source, /Use as All Cards display rate/);
  assert.match(production, /@api\.get\("\/admin\/headline-rates"\)/);
  assert.match(production, /@api\.post\("\/admin\/headline-rates"\)/);
  assert.match(production, /db\.headline_rates\.find_one_and_update/);
  assert.match(production, /"rate_minor_per_unit": x\.rate_minor_per_unit/);
});

test("Popular Gift Cards reads the same independent headline record and keeps bonus separate", () => {
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  const home = read("app/(tabs)/index.tsx");
  assert.match(server, /headline = await db\.headline_rates\.find_one/);
  assert.match(server, /headlines = await db\.headline_rates\.find/);
  assert.match(home, /item\.headline_rate\.rate_minor_per_unit/);
  assert.match(server, /row\.get\("bonus_enabled"\)/);
});

test("Admin Rates keeps headline pricing separate from detailed-rate management", () => {
  const source = read("app/admin/catalog.tsx");
  assert.doesNotMatch(source, /\/admin\/card-rates/);
  assert.doesNotMatch(source, /is_headline/);
  assert.match(source, /\/admin\/headline-rates/);
  assert.match(source, /\/admin\/detailed-rates/);
});
