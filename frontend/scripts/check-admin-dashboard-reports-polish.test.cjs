const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("dashboard summarizes live operations without decorative fake metrics", () => {
  const source = read("app/admin/index.tsx");
  assert.match(source, /Work summary/);
  assert.match(source, /pending_trades/);
  assert.match(source, /pending_withdrawals/);
  assert.match(source, /open_tickets/);
  assert.match(source, /pending_kyc/);
  assert.match(source, /refetchInterval: 15000/);
  assert.doesNotMatch(source, /revenue|profit/i);
});

test("dashboard keeps recent trades attention and activity as operational sections", () => {
  const source = read("app/admin/index.tsx");
  assert.match(source, /Recent trades/);
  assert.match(source, /testID="admin-attention-needed"/);
  assert.match(source, /Only actionable work appears here/);
  assert.match(source, /testID="admin-recent-activity"/);
  assert.match(source, /router\.push\(`\/admin\/trade\/\$\{trade\.id\}`\)/);
  assert.match(source, /Verification remains available in the workspace but is paused/);
});

test("reports use compact live metrics and a desktop rate activity table", () => {
  const source = read("app/admin/reports.tsx");
  assert.match(source, /Operations report/);
  assert.match(source, /reports-operations-snapshot/);
  assert.match(source, /reports-rate-activity/);
  assert.match(source, />Card</);
  assert.match(source, />Market</);
  assert.match(source, />Change</);
  assert.match(source, />Payout</);
  assert.match(source, />Recorded</);
  assert.match(source, /No revenue, profit, or payout estimates are invented here/);
});

test("top bar notification menu presents assigned work as attention queues", () => {
  const source = read("app/admin/_layout.tsx");
  assert.match(source, /Needs attention/);
  assert.match(source, /Pending trades/);
  assert.match(source, /Payout requests/);
  assert.match(source, /Open support/);
  assert.match(source, /popoverQueueIcon/);
  assert.match(source, /Your assigned work queues are clear/);
});
