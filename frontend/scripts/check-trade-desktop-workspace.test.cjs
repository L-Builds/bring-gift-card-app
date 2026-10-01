const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app", "admin", "trade", "[id].tsx"), "utf8");

test("trade details uses a desktop two-column workspace with a mobile column fallback", () => {
  assert.match(source, /const desktopWorkspace = viewportWidth >= 1024/);
  assert.match(source, /testID="admin-trade-workspace"/);
  assert.match(source, /styles\.workspaceMobile/);
  assert.match(source, /testID="admin-trade-review-panel"/);
  assert.match(source, /reviewColumnMobile/);
});

test("desktop workspace keeps trade, customer, review, evidence and activity areas", () => {
  assert.match(source, />Trade Information</);
  assert.match(source, />Customer</);
  assert.match(source, />Review</);
  assert.match(source, /testID="admin-trade-evidence-section"/);
  assert.match(source, />Activity</);
  assert.match(source, /Expected payout/);
  assert.match(source, /Payout per card/);
});

test("existing review behavior and permissions remain wired to the same endpoints", () => {
  assert.match(source, /const canAct = !\["APPROVED", "REJECTED"\]\.includes\(data\.status\)/);
  assert.match(source, /\/admin\/trades\/\$\{id\}\/approve/);
  assert.match(source, /\/admin\/trades\/\$\{id\}\/reject/);
  assert.match(source, /\/admin\/trades\/\$\{id\}\/need-info/);
  assert.match(source, /testID="admin-approve"/);
  assert.match(source, /testID="admin-reject"/);
  assert.match(source, /testID="admin-need-info"/);
  assert.match(source, /testID="admin-action-submit"/);
});

test("phase 1 private evidence viewer remains intact", () => {
  assert.match(source, /visible=\{viewerIndex !== null\}/);
  assert.match(source, /fileUrl\(viewerPath, token\)/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /contentFit="contain"/);
  assert.match(source, /admin-image-viewer-zoom-in/);
  assert.match(source, /admin-image-viewer-rotate/);
  assert.match(source, /admin-image-viewer-previous/);
  assert.match(source, /admin-image-viewer-next/);
});
