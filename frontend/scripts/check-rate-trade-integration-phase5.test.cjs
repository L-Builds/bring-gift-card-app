const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("All Cards uses only the independent admin-selected headline rate", () => {
  const rates = read("app/(tabs)/rates.tsx");
  const market = read("src/lib/market.ts");
  assert.match(rates, /useHeadlineRates\(\)/);
  assert.match(rates, /headline\.rate_minor_per_unit/);
  assert.doesNotMatch(rates, /rate\.is_headline/);
  assert.doesNotMatch(rates, /Display rate/);
  assert.doesNotMatch(rates, /Math\.max\([^)]*rate|highestRate/i);
  assert.match(market, /export type HeadlineRate/);
});

test("admin All Cards display rate is maintained by the independent headline editor", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /All Cards Display Rate/);
  assert.match(source, /\/admin\/headline-rates/);
  assert.match(source, /rate_minor_per_unit: amountMinor/);
  assert.doesNotMatch(source, /Use as All Cards display rate/);
});

test("Phase 6 Trade uses configured detailed country/type rates and free card value input", () => {
  const source = read("app/(tabs)/trade.tsx");
  assert.match(source, /useDetailedRates\(brand\?\.id \?\? ""\)/);
  assert.match(source, /rate\.submission_type === type/);
  assert.match(source, /card_country: country\.trim\(\)\.toUpperCase\(\)/);
  assert.match(source, /submission_type: type/);
  assert.match(source, /rate_minor_per_unit/);
  assert.match(source, />Rate per unit</);
  assert.doesNotMatch(source, /useCardRates\(\)/);
  assert.doesNotMatch(source, /configuredValues/);
  assert.doesNotMatch(source, /trade-quick-/);
  assert.doesNotMatch(source, /Range \$/);
});

test("backend Phase 6 quote and card discovery use new rate tables while legacy rows remain historical", () => {
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  const schema = fs.readFileSync(path.join(backend, "schema.py"), "utf8");
  const migration = fs.readFileSync(path.join(backend, "migrations", "013_trade_rate_cutover.sql"), "utf8");

  const quoteBlock = production.slice(production.indexOf("async def quote("), production.indexOf("async def provider("));
  assert.match(quoteBlock, /self\.db\.detailed_rates\.find_one/);
  assert.match(quoteBlock, /rate_minor_per_unit/);
  assert.doesNotMatch(quoteBlock, /self\.db\.card_rates/);
  assert.match(server, /db\.headline_rates\.distinct\("brand_id"/);
  assert.match(server, /db\.detailed_rates\.distinct\("brand_id"/);
  assert.match(server, /published_country_type = await db\.detailed_rates\.find_one/);
  assert.match(server, /rate = quote\["rate_minor_per_unit"\]/);
  assert.match(schema, /SCHEMA_VERSION = '013_trade_rate_cutover'/);
  assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
});
