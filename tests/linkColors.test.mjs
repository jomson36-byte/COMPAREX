import assert from "node:assert/strict";
import test from "node:test";
import { columnLinkColor, linkColors, linkColorStyle, resolveLinkColor, sanitizeColumnLinkColors } from "../app/linkColors.mts";

test("link colors are distinct and invalid stored values fall back safely", () => {
  assert.equal(new Set(linkColors.map((item) => item.id)).size, linkColors.length);
  assert.equal(resolveLinkColor("violet"), "violet");
  assert.equal(resolveLinkColor("#000000"), "blue");
  assert.equal(linkColorStyle("rose").fill, "#ec4899");
  assert.equal(linkColorStyle(null).id, "blue");
});

test("each Link column has one color that can be changed and restored", () => {
  assert.equal(columnLinkColor({}, 1), "blue");
  assert.equal(columnLinkColor({}, 2), "teal");
  const saved = sanitizeColumnLinkColors({ 1: "rose", 2: "violet", 0: "teal", 3: "invalid" });
  assert.deepEqual(saved, { 1: "rose", 2: "violet" });
  assert.equal(columnLinkColor(saved, 1), "rose");
  assert.equal(columnLinkColor(saved, 2), "violet");
  assert.equal(columnLinkColor(saved, 3), "violet");
});
