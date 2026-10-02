const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Phase 5 individual card page uses configured detailed rates, not denomination rows", () => {
  const source = read("app/(tabs)/rates.tsx");
  const market = read("src/lib/market.ts");
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");

  assert.match(source, /useDetailedRates\(selectedBrandId\)/);
  assert.match(market, /export type DetailedRate/);
  assert.match(market, /\/detailed-rates\?brand_id=/);
  assert.match(production, /@api\.get\("\/detailed-rates"\)/);
  assert.match(production, /db\.detailed_rates\.find\(/);
  assert.match(production, /"is_active": True/);
  assert.match(production, /"archived_at": None/);

  assert.doesNotMatch(source, /useCardRates\(\)/);
  assert.doesNotMatch(source, />Card Value</);
  assert.doesNotMatch(source, />Type</);
  assert.doesNotMatch(source, /Range \$\$/);
  assert.doesNotMatch(source, /brandSummary/);
});

test("Phase 5 layout has left-side countries, Physical Code toggle and one Rate per unit", () => {
  const source = read("app/(tabs)/rates.tsx");

  assert.match(source, /individual-card-rate-workspace/);
  assert.match(source, />Countries</);
  assert.match(source, /styles\.countryRail/);
  assert.match(source, /rates-type-toggle/);
  assert.match(source, />PHYSICAL</);
  assert.match(source, />CODE</);
  assert.match(source, /Rate per unit/);
  assert.match(source, /selectedRate\.rate_minor_per_unit/);
  assert.match(source, /setSelectedCountry\(country\)/);
  assert.match(source, /setSelectedType\("physical"\)/);
  assert.match(source, /setSelectedType\("ecode"\)/);

  assert.doesNotMatch(source, />General</);
  assert.doesNotMatch(source, /countries? · .*rates?/);
});

test("Phase 5 All Cards behavior remains intact after the Phase 6 Trade cutover", () => {
  const rates = read("app/(tabs)/rates.tsx");
  const trade = read("app/(tabs)/trade.tsx");

  assert.match(rates, /useHeadlineRates\(\)/);
  assert.match(rates, /headline\.rate_minor_per_unit/);
  assert.match(rates, /\$1 = \$\{formatMoney\(/);
  assert.match(trade, /card_country: country\.trim\(\)\.toUpperCase\(\)/);
  assert.match(trade, /submission_type: type/);
});
