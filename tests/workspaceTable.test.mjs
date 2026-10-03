import assert from "node:assert/strict";
import test from "node:test";
import { colorsByTableColumns, isRowBorderGrabPoint, linkTargetForCell, moveTableRows, nextAvailableLinkColumn, nextRequirementRowId, requirementNumbersByEvidenceMark, selectedRowGroups, tableEvidenceForRow, tableLinkAtColumn, tableLinkSlotsForRow, tableRowMovePreview, unassignedTableHighlights } from "../app/workspaceTable.mts";

test("only an empty requirement Link cell arms direct PDF highlighting", () => {
  const rows = [
    { kind: "requirement", mark: { id: "row-1" }, links: [{ column: 1 }] },
    { kind: "unassigned", mark: { id: "highlight-1" } },
  ];
  assert.equal(linkTargetForCell(rows, [3, 0], 2), rows[0]);
  assert.equal(linkTargetForCell(rows, [2, 0], 2), null);
  assert.equal(linkTargetForCell(rows, [4, 0], 2), null);
  assert.equal(linkTargetForCell(rows, [3, 1], 2), null);
  assert.equal(linkTargetForCell(rows, [3, 2], 2), null);
  assert.equal(linkTargetForCell(rows, undefined, 2), null);
});

test("Link columns navigate each linked mark separately without a fixed source role", () => {
  const first = { id: "a", fileName: "catalog-a.pdf" };
  const second = { id: "b", fileName: "catalog-b.pdf" };
  const links = [first, second];
  assert.equal(tableLinkAtColumn(links, 2), first);
  assert.equal(tableLinkAtColumn(links, 3), second);
  assert.equal(tableLinkAtColumn(links, 4), undefined);
  assert.equal(tableLinkAtColumn([{ ...first, column: 3 }], 2), undefined);
  assert.equal(tableLinkAtColumn([{ ...first, column: 3 }], 4)?.id, "a");
});

test("added Link columns retain empty cells and assigned links after unlinking", () => {
  const row = { id: "row", side: "tor", manual: true };
  const first = { id: "first", side: "catalog" };
  const second = { id: "second", side: "catalog" };
  const links = [
    { id: "one", sourceId: row.id, targetId: first.id, column: 1 },
    { id: "two", sourceId: row.id, targetId: second.id, column: 3 },
  ];
  const slots = tableLinkSlotsForRow([row, first, second], row, links);
  assert.deepEqual(slots.map(({ mark, column }) => [mark.id, column]), [["first", 1], ["second", 3]]);
  assert.equal(tableLinkAtColumn(slots, 3), undefined);
  assert.equal(nextAvailableLinkColumn(slots), 2);
  assert.equal(nextAvailableLinkColumn(slots, 4), 4);
  const afterUnlink = tableLinkSlotsForRow([row, first, second], row, [links[1]]);
  assert.deepEqual(afterUnlink.map(({ mark, column }) => [mark.id, column]), [["second", 3]]);
});

test("PDF highlights take the color of their Link column across rows", () => {
  const firstRow = { id: "row-1", side: "tor", manual: true };
  const secondRow = { id: "row-2", side: "tor", manual: true };
  const firstMark = { id: "mark-1", side: "catalog" };
  const sharedMark = { id: "shared", side: "catalog" };
  const marks = [firstRow, secondRow, firstMark, sharedMark];
  const links = [
    { id: "a", sourceId: firstRow.id, targetId: firstMark.id, column: 1 },
    { id: "b", sourceId: secondRow.id, targetId: sharedMark.id, column: 1 },
    { id: "c", sourceId: firstRow.id, targetId: sharedMark.id, column: 2 },
  ];
  const colors = colorsByTableColumns(marks, [firstRow, secondRow], links, { 1: "rose", 2: "teal" });
  assert.deepEqual(colors.get(firstMark.id), ["rose"]);
  assert.deepEqual(colors.get(sharedMark.id), ["teal", "rose"]);
});

test("Auto next follows table order and stops after the last requirement", () => {
  const rows = [
    { kind: "requirement", mark: { id: "parent" } },
    { kind: "requirement", mark: { id: "child" } },
    { kind: "requirement", mark: { id: "next" } },
    { kind: "unassigned", mark: { id: "unlinked-highlight" } },
  ];
  assert.equal(nextRequirementRowId(rows, "parent"), "child");
  assert.equal(nextRequirementRowId(rows, "child"), "next");
  assert.equal(nextRequirementRowId(rows, "next"), null);
  assert.equal(nextRequirementRowId(rows, "missing"), null);
});

test("moving a row preserves manual numbers and links on each row", () => {
  const parent = { id: "parent", text: "First", side: "tor", requirementNo: "4.1" };
  const child = { id: "child", parentId: "parent", text: "Child", side: "tor", linkId: "child-link" };
  const highlight = { id: "highlight", side: "catalog" };
  const next = { id: "next", text: "Second", side: "tor", linkId: "next-link" };
  const marks = [parent, child, highlight, next];
  const moved = moveTableRows(marks, ["parent"], "next", (mark) => mark.side === "tor", "after");
  assert.deepEqual(moved.map((mark) => mark.id), ["child", "next", "highlight", "parent"]);
  assert.equal(moved.find((mark) => mark.id === "child"), child);
  assert.equal(moved.find((mark) => mark.id === "next")?.linkId, "next-link");
  assert.equal(moved.find((mark) => mark.id === "highlight"), highlight);
  assert.equal(moved.find((mark) => mark.id === "parent")?.requirementNo, "4.1");
});

test("moving rows across former levels preserves unrelated row positions", () => {
  const rows = [
    { id: "parent", side: "tor" },
    { id: "first", side: "tor", parentId: "parent" },
    { id: "evidence", side: "catalog" },
    { id: "second", side: "tor", parentId: "parent" },
    { id: "other", side: "tor" },
  ];
  const isRow = (item) => item.side === "tor";
  assert.deepEqual(moveTableRows(rows, ["second"], "first", isRow, "before").map((row) => row.id),
    ["parent", "second", "evidence", "first", "other"]);
  assert.deepEqual(moveTableRows(rows, ["first"], "other", isRow, "after").map((row) => row.id),
    ["parent", "second", "evidence", "other", "first"]);
  assert.deepEqual(moveTableRows(rows, ["evidence"], "first", isRow, "before"), rows);
});

test("moving multiple selected rows keeps their order, labels, links, and unrelated marks", () => {
  const rows = [
    { id: "one", side: "tor", requirementNo: "A1", linkId: "link-one" },
    { id: "two", side: "tor", requirementNo: "A2" },
    { id: "evidence", side: "catalog" },
    { id: "three", side: "tor", requirementNo: "A3", linkId: "link-three" },
    { id: "four", side: "tor", requirementNo: "A4" },
  ];
  const isRow = (item) => item.side === "tor";
  const moved = moveTableRows(rows, ["one", "three"], "four", isRow, "after");
  assert.deepEqual(moved.map((row) => row.id), ["two", "four", "evidence", "one", "three"]);
  assert.equal(moved.find((row) => row.id === "one"), rows[0]);
  assert.equal(moved.find((row) => row.id === "three"), rows[3]);
  assert.equal(moved.find((row) => row.id === "evidence"), rows[2]);
  assert.deepEqual(moveTableRows(rows, ["one", "three"], "three", isRow, "after"), rows);
});

test("drag preview marks the insertion edge across former levels", () => {
  const rows = [
    { kind: "requirement", mark: { parentId: undefined } },
    { kind: "requirement", mark: { parentId: "first" } },
    { kind: "requirement", mark: { parentId: undefined } },
    { kind: "unassigned", mark: {} },
  ];
  assert.deepEqual(tableRowMovePreview(rows, 0, 2), { valid: true, edge: "bottom" });
  assert.deepEqual(tableRowMovePreview(rows, 2, 0), { valid: true, edge: "top" });
  assert.deepEqual(tableRowMovePreview(rows, 0, 1), { valid: true, edge: "bottom" });
  assert.equal(tableRowMovePreview(rows, 0, 1, [0, 1]).valid, false);
  assert.equal(tableRowMovePreview(rows, 0, 3).valid, false);
});

test("selected row borders combine adjacent rows and split across gaps", () => {
  assert.deepEqual(selectedRowGroups([6, 2, 1, 3, 6]), [
    { start: 1, end: 3 },
    { start: 6, end: 6 },
  ]);
});

test("row movement starts at the selected border, not its interior or a distant cell", () => {
  const border = { x: 100, y: 200, width: 400, height: 150 };
  assert.equal(isRowBorderGrabPoint({ x: 103, y: 270 }, border), true);
  assert.equal(isRowBorderGrabPoint({ x: 300, y: 203 }, border), true);
  assert.equal(isRowBorderGrabPoint({ x: 300, y: 347 }, border), true);
  assert.equal(isRowBorderGrabPoint({ x: 300, y: 270 }, border), false);
  assert.equal(isRowBorderGrabPoint({ x: 300, y: 190 }, border), false);
});

test("PDF labels follow explicit row links and legacy links, including Thai numbers", () => {
  const first = { id: "row-1", side: "tor", manual: true };
  const second = { id: "row-2", side: "tor", manual: true, linkId: "old-pair" };
  const graphEvidence = { id: "new-evidence", side: "catalog" };
  const legacyEvidence = { id: "old-evidence", side: "catalog", linkId: "old-pair" };
  const unrelated = { id: "unrelated", side: "catalog" };
  const marks = [first, second, graphEvidence, legacyEvidence, unrelated];
  const rows = [{ mark: first, number: "1" }, { mark: second, number: "๒" }];
  const links = [
    { id: "a", sourceId: first.id, targetId: graphEvidence.id },
    { id: "b", sourceId: second.id, targetId: graphEvidence.id },
    { id: "c", sourceId: graphEvidence.id, targetId: unrelated.id },
  ];
  const labels = requirementNumbersByEvidenceMark(marks, rows, links);
  assert.deepEqual(labels.get(graphEvidence.id), ["1", "๒"]);
  assert.deepEqual(labels.get(legacyEvidence.id), ["๒"]);
  assert.equal(labels.has(unrelated.id), false);
  assert.equal(labels.has(first.id), false);
});

test("Review Table shows explicit row links from either PDF pane", () => {
  const row = { id: "row-1", side: "tor", manual: true };
  const left = { id: "left-highlight", side: "tor" };
  const right = { id: "right-highlight", side: "catalog" };
  const unrelated = { id: "other-highlight", side: "catalog" };
  const links = [
    { id: "link-1", sourceId: row.id, targetId: left.id },
    { id: "link-2", sourceId: right.id, targetId: row.id },
  ];
  assert.deepEqual(tableEvidenceForRow([row, left, right, unrelated], row, links), [left, right]);
  assert.deepEqual(
    unassignedTableHighlights([left, right, unrelated], new Set([row.id]), new Set(), links),
    [unrelated],
  );
});

test("legacy row links remain visible after adding a graph link", () => {
  const row = { id: "row-1", side: "tor", linkId: "legacy" };
  const oldEvidence = { id: "old", side: "catalog", linkId: "legacy" };
  const newEvidence = { id: "new", side: "catalog" };
  const links = [{ id: "link-1", sourceId: row.id, targetId: newEvidence.id }];
  assert.deepEqual(tableEvidenceForRow([row, oldEvidence, newEvidence], row, links), [oldEvidence, newEvidence]);
});
