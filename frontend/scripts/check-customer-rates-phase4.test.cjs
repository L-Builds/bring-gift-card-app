const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Phase 4 All Cards is a simple logo name and independent headline-rate list", () => {
  const source = read("app/(tabs)/rates.tsx");
  const market = read("src/lib/market.ts");
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");

  assert.match(source, /All Cards/);
  assert.match(source, /useHeadlineRates\(\)/);
  assert.match(source, /headline\.rate_minor_per_unit/);
  assert.match(source, /\$1 = \$\{formatMoney\(/);
  assert.match(market, /\/headline-rates\?market_code=/);
  assert.match(production, /@api\.get\("\/headline-rates"\)/);
  assert.match(production, /db\.headline_rates\.find\(/);

  const branchStart = source.indexOf("if (!selectedBrand) {\n          const brand = item as Brand");
  const allCardsBranch = source.slice(branchStart, source.indexOf("const rate = item as CardRate", branchStart));
  assert.doesNotMatch(allCardsBranch, /brandSummary/);
  assert.doesNotMatch(allCardsBranch, /Display rate/);
  assert.doesNotMatch(allCardsBranch, /View rates/);
  assert.doesNotMatch(allCardsBranch, /bonus/i);
  assert.doesNotMatch(source, /Payouts shown in/);
});

test("Phase 4 All Cards remains isolated while later individual-card phases evolve", () => {
  const source = read("app/(tabs)/rates.tsx");
  assert.match(source, /purpose=rates/);
  const branchStart = source.indexOf("if (!selectedBrand) {");
  const branchEnd = source.indexOf("if (detailed.isLoading)", branchStart);
  const allCardsBranch = source.slice(branchStart, branchEnd);
  assert.match(allCardsBranch, /headline\.rate_minor_per_unit/);
  assert.doesNotMatch(allCardsBranch, /Rate per unit/);
  assert.doesNotMatch(allCardsBranch, /PHYSICAL|CODE/);
});

test("rate model separates gift-card country from payout market", () => {
  const schema = fs.readFileSync(path.join(backend, "schema.py"), "utf8");
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  const migration = fs.readFileSync(path.join(backend, "migrations", "008_rate_card_country.sql"), "utf8");
  assert.match(schema, /market_code card_country submission_type/);
  assert.match(schema, /SCHEMA_VERSION = '013_trade_rate_cutover'/);
  assert.match(production, /card_country: str/);
  assert.match(production, /"card_country": x\.card_country/);
  assert.match(migration, /ADD COLUMN card_country/);
  assert.match(migration, /card_rates_rule_unique/);
});

test("Phase 6 separates All Cards discovery from current detailed-rate tradability", () => {
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  assert.match(server, /async def rate_view_brand_ids/);
  assert.match(server, /db\.headline_rates\.distinct/);
  assert.match(server, /purpose: Literal\["trade", "rates"\]/);
  assert.match(server, /tradable_ids = await tradable_brand_ids\(market_code\)/);
  assert.match(server, /rate_view_brand_ids\(market_code\) if purpose == "rates" else tradable_ids/);
  assert.match(server, /brand_response\(b, tradable=b\["id"\] in tradable_ids\)/);
  assert.match(server, /async def tradable_brand_ids/);
  assert.match(server, /db\.detailed_rates\.distinct/);
  assert.doesNotMatch(server, /async def tradable_brand_ids[\s\S]{0,800}return await rate_view_brand_ids\(market_code\)/);
});
