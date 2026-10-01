const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("All Cards uses only admin-selected headline rates", () => {
  const rates = read("app/(tabs)/rates.tsx");
  const market = read("src/lib/market.ts");
  assert.match(rates, /rate\.is_headline/);
  assert.match(rates, /Display rate/);
  assert.doesNotMatch(rates, /Math\.max\([^)]*rate|highestRate/i);
  assert.match(market, /is_headline: boolean/);
});

test("admin rate editor can choose the All Cards display rate", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /Use as All Cards display rate/);
  assert.match(source, /is_headline: rateDraft\.isHeadline/);
  assert.match(source, /All Cards display rate/);
});

test("Trade sends the selected card country and submission type to the same quote API", () => {
  const source = read("app/(tabs)/trade.tsx");
  assert.match(source, /card_country: country\.trim\(\)\.toUpperCase\(\)/);
  assert.match(source, /submission_type: type/);
  assert.match(source, /rate_minor_per_usd/);
  assert.match(source, /availableCountries/);
  assert.match(source, /typeRateRows/);
});

test("backend exact matching uses total face value and preserves legacy fallbacks", () => {
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  const schema = fs.readFileSync(path.join(backend, "schema.py"), "utf8");
  const migration = fs.readFileSync(path.join(backend, "migrations", "009_headline_trade_rates.sql"), "utf8");
  assert.match(production, /total_face_value = face_value \* quantity/);
  assert.match(production, /select_rate_rule\(rows, card_country, submission_type, total_face_value\)/);
  assert.match(server, /card_country=x\.country, submission_type=x\.submission_type/);
  assert.match(server, /rate = quote\["rate_minor_per_usd"\]/);
  assert.match(schema, /is_active is_headline/);
  assert.match(schema, /SCHEMA_VERSION = '009_headline_trade_rates'/);
  assert.match(migration, /card_rates_headline_unique/);
});
