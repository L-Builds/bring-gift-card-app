const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backend = path.resolve(root, "..", "backend");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home Popular Gift Cards uses the dedicated public collection and headline rate", () => {
  const source = read("app/(tabs)/index.tsx");
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  assert.match(source, /\/popular-cards\?market_code=/);
  assert.match(source, /item\.headline_rate\.rate_minor_per_unit/);
  assert.match(source, /\$1 = \$\{currencyAmount/);
  assert.match(server, /@api\.get\("\/popular-cards"\)/);
  assert.match(server, /db\.headline_rates\.find_one/);
});

test("Popular section stays outside the guest-versus-balance branch and has no row chevrons", () => {
  const source = read("app/(tabs)/index.tsx");
  const balanceEnd = source.indexOf("        )}\n\n        <View style={styles.sectionCard}>");
  assert.ok(balanceEnd > 0, "Popular section must follow the shared guest/auth hero-or-balance block");
  const listStart = source.indexOf("{popularCards.map");
  const listEnd = source.indexOf("            </View>\n          )}", listStart);
  assert.ok(listStart > 0 && listEnd > listStart);
  const listBlock = source.slice(listStart, listEnd);
  assert.doesNotMatch(listBlock, /chevron-forward/);
  assert.match(source, /<Text style={styles\.sectionTitle}>Popular Gift Cards<\/Text>/);
});

test("Bonus is rendered only when enabled and uses the locked two-line optional shape", () => {
  const source = read("app/(tabs)/index.tsx");
  assert.match(source, /item\.bonus\?\.enabled \?/);
  assert.match(source, /\+ \{currencyAmount\(item\.bonus\.amount_minor/);
  assert.match(source, /\} bonus/);
  assert.match(source, /\$\{item\.bonus\.min_card_value_usd\} card upward/);
  assert.doesNotMatch(source, /No bonus|Bonus unavailable|bonus disabled/i);
});

test("Public Popular endpoint exposes bonus only from an active bonus market", () => {
  const server = fs.readFileSync(path.join(backend, "server.py"), "utf8");
  assert.match(server, /row\.get\("bonus_enabled"\)/);
  assert.match(server, /"code": row\["bonus_market_code"\],[\s\S]*"is_active": True/);
  assert.match(server, /"amount_minor": row\["bonus_amount_minor"\]/);
  assert.match(server, /"min_card_value_usd": row\.get\("min_card_value_usd"\)/);
});
