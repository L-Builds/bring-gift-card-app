const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const backend = path.resolve(root, "..", "backend");

const expectedCards = [
  "Apple / iTunes", "Steam", "Razer Gold", "Amazon", "Xbox", "eBay", "Google Play",
  "PlayStation", "Sephora", "Vanilla", "Visa", "American Express", "Walmart", "Target",
  "Nike", "Nordstrom", "Macy's", "Foot Locker", "Best Buy", "GameStop", "Roblox",
  "Mastercard", "Paysafecard", "Netflix", "Adidas", "Kohl's", "Saks", "Ulta",
  "OffGamers", "Netspend Visa", "One4all",
];

test("phase 2 seeds the agreed catalog inactive without sample rates", () => {
  const migration = fs.readFileSync(path.join(backend, "migrations", "007_full_catalog.sql"), "utf8");
  const normalized = migration.replaceAll("''", "'");
  for (const name of expectedCards) assert.ok(normalized.includes(name), `missing ${name}`);
  assert.match(migration, /false,\s*false,\s*now\(\)/);
  assert.doesNotMatch(migration, /INSERT INTO card_rates/i);
});

test("catalog editor keeps logo management and adds safe delete archive controls", () => {
  const source = read("app/admin/catalog.tsx");
  assert.match(source, /Current Logo/);
  assert.match(source, /catalog-logo-replace/);
  assert.match(source, /catalog-logo-remove/);
  assert.match(source, /Delete \/ Archive Card/);
  assert.match(source, /catalog-delete-confirm-action/);
  assert.match(source, /\/admin\/brands\/\$\{encodeURIComponent\(form\.id\)\}/);
  assert.match(source, /trade history.*archived/i);
});

test("large logo uploads remain normalized and removable", () => {
  const services = fs.readFileSync(path.join(backend, "private_services.py"), "utf8");
  const transport = fs.readFileSync(path.join(backend, "upload_transport.py"), "utf8");
  assert.match(services, /ImageOps\.contain/);
  assert.match(services, /\(512, 512\)/);
  assert.match(services, /format="PNG"/);
  assert.match(transport, /purpose.*brand_logo/);
  assert.match(transport, /clean_brand_logo/);
});

test("catalog keeps bundled known artwork aliases while unknown cards fall back cleanly", () => {
  const source = read("src/components/brand-icon.tsx");
  assert.match(source, /"apple \/ itunes"/);
  assert.match(source, /"foot locker"/);
  assert.match(source, /BrandMonogram/);
  assert.match(source, /contentFit="contain"/);
});
