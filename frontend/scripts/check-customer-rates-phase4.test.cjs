const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("customer rates page uses card tabs then country tabs and clean rate rows", () => {
  const source = read("app/(tabs)/rates.tsx");
  assert.match(source, /All Cards/);
  assert.match(source, /rates-brand-tabs/);
  assert.match(source, /rates-country-tabs/);
  assert.match(source, />Card Value</);
  assert.match(source, />Type</);
  assert.match(source, />Rate</);
  assert.match(source, /Range \$\$\{rate\.range_min\}–\$\$\{rate\.range_max\}/);
  assert.match(source, /\/\$1/);
  assert.match(source, /purpose=rates/);
  assert.doesNotMatch(source, /50\(100~500\)/);
  assert.doesNotMatch(source, /multiple/);
});

test("all cards view avoids inventing one headline rate when a card has many rules", () => {
  const source = read("app/(tabs)/rates.tsx");
  assert.match(source, /View rates/);
  assert.match(source, /brandSummary/);
  assert.doesNotMatch(source, /highestRate|Math\.max\([^)]*rate/i);
});

test("rate model separates gift-card country from payout market", () => {
  const schema = fs.readFileSync(path.join(backend, "schema.py"), "utf8");
  const production = fs.readFileSync(path.join(backend, "production.py"), "utf8");
  const migration = fs.readFileSync(path.join(backend, "migrations", "008_rate_card_country.sql"), "utf8");
  assert.match(schema, /market_code card_country submission_type/);
  assert.match(schema, /SCHEMA_VERSION = '009_headline_trade_rates'/);
  assert.match(production, /card_country: str/);
  assert.match(production, /"card_country": x\.card_country/);
  assert.match(migration, /ADD COLUMN card_country/);
  assert.match(migration, /card_rates_rule_unique/);
});

test("public rate-brand discovery remains shared with the Phase 5 tradable-card flow", () => {
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  assert.match(server, /async def rate_view_brand_ids/);
  assert.match(server, /purpose: Literal\["trade", "rates"\]/);
  assert.match(server, /rate_view_brand_ids\(market_code\) if purpose == "rates" else tradable_brand_ids\(market_code\)/);
  assert.match(server, /async def tradable_brand_ids/);
  assert.match(server, /return await rate_view_brand_ids\(market_code\)/);
});
