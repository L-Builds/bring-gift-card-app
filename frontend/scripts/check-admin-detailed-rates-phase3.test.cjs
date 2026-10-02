const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Phase 3 admin detailed rates are country-specific Physical/Code per-unit rates", () => {
  const source = read("app/admin/catalog.tsx");
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  assert.match(source, /Detailed Card Rates/);
  assert.match(source, /testID="detailed-country-add"/);
  assert.match(source, /testID="detailed-physical-rate"/);
  assert.match(source, /testID="detailed-code-rate"/);
  assert.match(source, />Rate per unit</);
  assert.match(source, /No country is added automatically/);
  assert.doesNotMatch(source, /Card value \(USD\)/);
  assert.doesNotMatch(source, /Total trade range/);
  assert.match(production, /class DetailedCountryRatesIn/);
  assert.match(production, /@api\.get\("\/admin\/detailed-rates"\)/);
  assert.match(production, /@api\.post\("\/admin\/detailed-rates\/country"\)/);
  assert.match(production, /db\.detailed_rates\.find_one_and_update/);
  assert.match(production, /"submission_type": submission_type/);
  assert.match(production, /"rate_minor_per_unit": amount/);
});

test("Phase 3 supports disabling, enabling and removing only configured card countries", () => {
  const source = read("app/admin/catalog.tsx");
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  assert.match(source, /Disable Country/);
  assert.match(source, /Enable Country/);
  assert.match(source, /Remove Country/);
  assert.match(production, /\/disable"\)/);
  assert.match(production, /\/enable"\)/);
  assert.match(production, /@api\.delete\("\/admin\/detailed-rates\/\{brand_id\}\/\{market_code\}\/\{card_country\}"\)/);
  assert.match(production, /"archived_at": timestamp/);
});
