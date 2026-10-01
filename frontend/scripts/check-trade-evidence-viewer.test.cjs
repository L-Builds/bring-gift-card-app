const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app", "admin", "trade", "[id].tsx"), "utf8");

test("trade evidence thumbnails open a private authenticated full-screen viewer", () => {
  assert.match(source, /onPress=\{\(\) => openViewer\(index\)\}/);
  assert.match(source, /visible=\{viewerIndex !== null\}/);
  assert.match(source, /fileUrl\(viewerPath, token\)/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /contentFit="contain"/);
});

test("viewer exposes zoom, rotate and multi-image navigation without OCR", () => {
  assert.match(source, /Math\.max\(1, Number\(\(value - 0\.5\)/);
  assert.match(source, /Math\.min\(3, Number\(\(value \+ 0\.5\)/);
  assert.match(source, /\(value \+ 90\) % 360/);
  assert.match(source, /Image \$\{viewerIndex \+ 1\} of \$\{data\.image_paths\.length\}/);
  assert.match(source, /admin-image-viewer-previous/);
  assert.match(source, /admin-image-viewer-next/);
  assert.doesNotMatch(source, /\bOCR\b|textRecognition|recognizeText/i);
});

test("viewer keeps separate desktop and mobile sizing paths", () => {
  assert.match(source, /viewportWidth >= 768 \? 120 : 24/);
  assert.match(source, /viewportWidth >= 768 \? 210 : 300/);
  assert.match(source, /statusBarTranslucent/);
  assert.match(source, /paddingTop: insets\.top \+ spacing\.md/);
  assert.match(source, /paddingBottom: insets\.bottom \+ spacing\.md/);
});
