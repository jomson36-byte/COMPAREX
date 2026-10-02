import assert from "node:assert/strict";
import test from "node:test";
import { evidenceCellSummary, evidenceTargetForCell, nextRequirementRowId, requirementNumbersByEvidenceMark, tableEvidenceForRow, unassignedTableHighlights } from "../app/workspaceTable.mts";

test("only a requirement Evidence cell arms direct PDF highlighting", () => {
  const rows = [
    { kind: "requirement", mark: { id: "row-1" } },
    { kind: "unassigned", mark: { id: "highlight-1" } },
  ];
  assert.equal(evidenceTargetForCell(rows, [3, 0]), rows[0]);
  assert.equal(evidenceTargetForCell(rows, [1, 0]), null);
  assert.equal(evidenceTargetForCell(rows, [3, 1]), null);
  assert.equal(evidenceTargetForCell(rows, [3, 2]), null);
  assert.equal(evidenceTargetForCell(rows, undefined), null);
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

test("Evidence summary counts separate files even when they share a page number", () => {
  const evidence = [
    { documentId: "file-a", fileName: "catalog.pdf", page: 1 },
    { documentId: "file-b", fileName: "catalog.pdf", page: 1 },
  ];
  assert.equal(evidenceCellSummary(evidence), "2 หลักฐาน · 2 ไฟล์");
  assert.equal(evidenceCellSummary([
    { documentId: "file-a", fileName: "catalog.pdf", page: 1 },
    { documentId: "file-a", fileName: "catalog.pdf", page: 2 },
  ]), "2 หลักฐาน · 1 ไฟล์");
  assert.equal(evidenceCellSummary([]), "");
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
