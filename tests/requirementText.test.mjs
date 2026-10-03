import assert from "node:assert/strict";
import test from "node:test";
import { anchoredRequirementTextPosition, clampRequirementTextPosition, clampRequirementTextScale, latestRequirementTextPlacement, layoutRequirementText, removeRequirementTextPlacements, resizedRequirementTextScale, sanitizeRequirementTextPlacements } from "../app/requirementText.mts";

test("placed text retains its source row, document, page, and normalized point", () => {
  const placement = { id: "stamp", rowId: "row", documentId: "doc", page: 2, x: 0.7, y: 0.8, text: "ลำโพง 12 นิ้ว" };
  assert.deepEqual(sanitizeRequirementTextPlacements([placement, { ...placement, id: "bad", x: 2 }]), [placement]);
});

test("placed text size is retained and bounded when a workspace is restored", () => {
  const placement = { id: "stamp", rowId: "row", documentId: "doc", page: 2, x: 0.2, y: 0.3, text: "ทดสอบ", scale: 1.8 };
  assert.deepEqual(sanitizeRequirementTextPlacements([placement]), [placement]);
  assert.equal(sanitizeRequirementTextPlacements([{ ...placement, scale: 20 }])[0].scale, 3);
  assert.equal(clampRequirementTextScale(0.1), 0.5);
});

test("short Thai Requirement text stays on one line and inside the PDF page", () => {
  const text = "ลำโพงตู้ซับวูฟเฟอร์ ๑๒ นิ้ว ๑๐๐๐วัตต์ มีแอมป์ในตัว จำนวน ๔ ตู้";
  const layout = layoutRequirementText(text, 900, 500, 0.7, 0.2, (value) => Array.from(value).length * 10);
  assert.deepEqual(layout.lines, [text]);
  assert.ok(layout.left + layout.width <= 900);
});

test("text longer than the PDF page wraps and remains on the page", () => {
  const text = "ทดสอบ TEST ทดสอบ TEST ".repeat(3).trim();
  const layout = layoutRequirementText(text, 400, 300, 0.95, 0.95, (value) => Array.from(value).length * 12);
  assert.ok(layout.lines.length > 1);
  assert.ok(layout.left + layout.width <= 400);
  assert.ok(layout.top + layout.height <= 300);
  assert.equal(layout.lines.join("").replaceAll(" ", ""), text.replaceAll(" ", ""));
});

test("resizing text changes its displayed size while keeping it on the page", () => {
  const text = "ลำโพง ๑๒ นิ้ว";
  const base = layoutRequirementText(text, 600, 800, 0.8, 0.3, (value) => value.length * 10);
  const enlarged = layoutRequirementText(text, 600, 800, 0.8, 0.3, (value) => value.length * 20, 2);
  assert.equal(enlarged.fontSize, base.fontSize * 2);
  assert.ok(enlarged.width > base.width);
  assert.ok(enlarged.left + enlarged.width <= 600);
});

test("corner resize keeps the opposite corner fixed and respects scale limits", () => {
  assert.equal(resizedRequirementTextScale(1, 60, 5, 200, 40, "se"), 1.3);
  assert.equal(resizedRequirementTextScale(1, -60, -5, 200, 40, "nw"), 1.3);
  assert.equal(resizedRequirementTextScale(1, 1000, 0, 200, 40, "se"), 3);
  const position = anchoredRequirementTextPosition(100, 80, 200, 40, 260, 52, 600, 800, "nw");
  assert.equal(position.left, 40);
  assert.equal(position.top, 68);
  assert.equal(position.left + 260, 300);
  assert.equal(position.top + 52, 120);
});

test("too much text fails rather than silently clipping a PDF page", () => {
  assert.throws(() => layoutRequirementText("ก".repeat(2000), 400, 300, 0, 0, (value) => value.length * 12), /too long/);
});

test("dragged text is clamped to page edges and stores its normalized position", () => {
  const position = clampRequirementTextPosition(500, -20, 600, 800, 252, 100);
  assert.deepEqual(position, { left: 348, top: 0, x: 348 / 600, y: 0 });
  assert.deepEqual(clampRequirementTextPosition(-30, 900, 600, 800, 250, 100), {
    left: 0, top: 700, x: 0, y: 700 / 800,
  });
  const saved = sanitizeRequirementTextPlacements([{
    id: "stamp", rowId: "row", documentId: "doc", page: 2,
    x: position.x, y: position.y, text: "ทดสอบ",
  }]);
  const layout = layoutRequirementText(saved[0].text, 600, 800, saved[0].x, saved[0].y, () => 12);
  assert.equal(layout.left, 348);
  assert.equal(layout.top, 0);
});

test("a Requirement with several placed copies opens the latest one", () => {
  const placements = [
    { id: "first", rowId: "row", documentId: "a", page: 1, x: 0.1, y: 0.2, text: "Text" },
    { id: "other", rowId: "different", documentId: "a", page: 1, x: 0.2, y: 0.3, text: "Other" },
    { id: "latest", rowId: "row", documentId: "b", page: 3, x: 0.4, y: 0.5, text: "Text" },
  ];
  assert.equal(latestRequirementTextPlacement(placements, "row")?.id, "latest");
  assert.equal(latestRequirementTextPlacement(placements, "missing"), undefined);
});

test("deleting linked Requirement text removes every placed copy without affecting other rows", () => {
  const placements = [
    { id: "first", rowId: "row", documentId: "a", page: 1, x: 0.1, y: 0.2, text: "Text" },
    { id: "second", rowId: "row", documentId: "b", page: 2, x: 0.2, y: 0.3, text: "Text" },
    { id: "other", rowId: "other", documentId: "a", page: 1, x: 0.3, y: 0.4, text: "Other" },
  ];
  assert.deepEqual(removeRequirementTextPlacements(placements, ["row"]), [placements[2]]);
});
