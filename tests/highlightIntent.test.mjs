import assert from "node:assert/strict";
import test from "node:test";
import { selectionAction } from "../app/highlightIntent.mts";

const base = {
  interactionMode: "highlight",
  neutralLinking: true,
  side: "catalog",
  pendingLinkId: null,
  evidenceTargetRowId: null,
};

test("a selected Evidence cell commits a PDF selection without the floating toolbar", () => {
  assert.equal(selectionAction({ ...base, evidenceTargetRowId: "row-1" }), "highlight");
  assert.equal(selectionAction({ ...base, pendingLinkId: "older-link", evidenceTargetRowId: "row-1" }), "highlight");
  assert.equal(selectionAction(base), "toolbar");
});

test("Link mode keeps its explicit linking action even when a row was selected", () => {
  assert.equal(selectionAction({ ...base, interactionMode: "link", evidenceTargetRowId: "row-1" }), "link");
  assert.equal(selectionAction({ ...base, side: "tor", evidenceTargetRowId: "row-1" }), "highlight");
});
