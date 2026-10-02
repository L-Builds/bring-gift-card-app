const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Popular Gift Cards is a separate catalog collection capped at eight", () => {
  const source = read("app/admin/catalog.tsx");
  const migration = fs.readFileSync(path.join(backend, "migrations", "011_popular_gift_cards.sql"), "utf8");
  assert.match(source, /All Gift Cards/);
  assert.match(source, /Popular Gift Cards/);
  assert.match(source, /popularRows\.length >= 8/);
  assert.match(source, /\/admin\/popular-cards/);
  assert.match(migration, /position BETWEEN 1 AND 8/);
  assert.match(migration, /UNIQUE \(brand_id\)/i);
});

test("Popular order, add, remove and edit controls are wired without duplicating main pricing", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /popular-cards\/reorder/);
  assert.match(source, /Remove from Popular/);
  assert.match(source, /movePopularCard/);
  assert.match(source, /Linked to headline\/display rate/);
  assert.match(source, /does not store a second price/);
  assert.doesNotMatch(source, /popular.*headline.*amount/i);
});

test("Bonus controls use active market currencies and the locked bonus shape", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /activeMarkets = .*filter\(\(item\) => item\.is_active\)/);
  assert.match(source, /Bonus currency/);
  assert.match(source, /Bonus amount/);
  assert.match(source, /Minimum card value \(USD, optional\)/);
  assert.match(source, /\$\{popularDraft\.minCardValue\} card upward/);
  assert.match(source, /bonus_enabled/);
  assert.match(source, /bonus_market_code/);
  assert.match(source, /bonus_amount_minor/);
});

test("Backend keeps Popular membership separate and headline rate remains the source of main price", () => {
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  const schema = fs.readFileSync(path.join(backend, "schema.py"), "utf8");
  assert.match(server, /@api\.get\("\/admin\/popular-cards"\)/);
  assert.match(server, /@api\.post\("\/admin\/popular-cards"\)/);
  assert.match(server, /@api\.post\("\/admin\/popular-cards\/reorder"\)/);
  assert.match(server, /db\.headline_rates/);
  assert.match(server, /Popular Gift Cards can contain at most 8 cards/);
  assert.match(schema, /popular_cards = table\('popular_cards'/);
  const version = /SCHEMA_VERSION = '(\d+)_/.exec(schema);
  assert.ok(version && Number(version[1]) >= 13, "rate cutover migration must remain applied");
});
