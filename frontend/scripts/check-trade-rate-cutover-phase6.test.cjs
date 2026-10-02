const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Phase 6 chain keeps headline, Popular, All Cards and detailed rates separated", () => {
  const home = read("app/(tabs)/index.tsx");
  const rates = read("app/(tabs)/rates.tsx");
  const trade = read("app/(tabs)/trade.tsx");

  assert.match(home, /item\.headline_rate\.rate_minor_per_unit/);
  assert.match(rates, /useHeadlineRates\(\)/);
  assert.match(rates, /useDetailedRates\(selectedBrandId\)/);
  assert.match(trade, /useDetailedRates\(brand\?\.id \?\? ""\)/);
  assert.match(trade, /configuredRateTypes/);
  assert.match(trade, /configuredRateTypes\.includes\(t\)/);
});

test("Phase 6 payout is card value times detailed rate per unit, with quantity preserved", () => {
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  const block = production.slice(production.indexOf("async def quote("), production.indexOf("async def provider("));
  assert.match(block, /per_unit = int\(rate\["rate_minor_per_unit"\]\)/);
  assert.match(block, /unit_payout = per_unit \* face_value/);
  assert.match(block, /"payout_minor": unit_payout \* quantity/);
  assert.match(block, /"card_country": country/);
  assert.match(block, /"submission_type": submission_type/);
});

test("Phase 6 old denomination rows are not deleted or used for new trade pricing", () => {
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  const migration = fs.readFileSync(path.join(backend, "migrations", "013_trade_rate_cutover.sql"), "utf8");
  const block = production.slice(production.indexOf("async def quote("), production.indexOf("async def provider("));
  assert.doesNotMatch(block, /card_rates\.find/);
  assert.match(production, /await db\.headline_rates\.count_documents/);
  assert.match(production, /await db\.detailed_rates\.count_documents/);
  assert.match(migration, /historical/i);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\s+card_rates\b/i);
});
