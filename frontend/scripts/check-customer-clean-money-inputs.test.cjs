const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("customer text inputs never get a second browser focus rectangle", () => {
  for (const file of ["public/index.html", "app/+html.tsx"]) {
    const html = read(file);
    assert.match(html, /input:focus,[\s\S]*outline: none !important/);
    assert.doesNotMatch(html, /div:has\(> :is\(input, textarea\):focus-visible/);
    assert.doesNotMatch(html, /div:has\(> input:focus-visible\[data-testid\^="admin-"/);
  }
});

test("trade payout keeps the amount together and moves rate below it", () => {
  const trade = read("app/(tabs)/trade.tsx");
  assert.match(trade, /style=\{styles\.payoutMain\}/);
  assert.match(trade, /numberOfLines=\{1\}[\s\S]*adjustsFontSizeToFit/);
  assert.match(trade, /rateBox: \{ paddingTop: spacing\.md, borderTopWidth: 1/);
});

test("withdrawal amount uses a separate currency prefix and neutral numeric placeholder", () => {
  const withdraw = read("app/withdraw.tsx");
  assert.match(withdraw, /currencyPrefix = user\?\.currency === "NGN" \? "₦"/);
  assert.match(withdraw, /Withdrawal amount/);
  assert.match(withdraw, /<Text style=\{styles\.currencyPrefix\}>\{currencyPrefix\}<\/Text>/);
  assert.match(withdraw, /placeholder="0\.00"/);
  assert.doesNotMatch(withdraw, /placeholder=\{`\$\{user\?\.currency \|\| "NGN"\} amount`\}/);
});
