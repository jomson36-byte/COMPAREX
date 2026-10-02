import assert from "node:assert/strict";
import test from "node:test";
import {
  closeWorkspaceTab,
  emptyWorkspaceTabs,
  initialWorkspaceTabs,
  openWorkspaceTab,
  removeWorkspaceDocumentTabs,
  restoreReviewTableTabs,
  reviewTableId,
} from "../app/workspaceTabs.mts";

test("opens the same PDF in both editors independently", () => {
  let tabs = emptyWorkspaceTabs();
  tabs = openWorkspaceTab(tabs, "left", "pdf-a");
  tabs = openWorkspaceTab(tabs, "right", "pdf-a");
  assert.equal(tabs.left.activeId, "pdf-a");
  assert.equal(tabs.right.activeId, "pdf-a");
  tabs = closeWorkspaceTab(tabs, "left", "pdf-a");
  assert.equal(tabs.left.activeId, null);
  assert.equal(tabs.right.activeId, "pdf-a");
});

test("switches tabs without duplicating files and restores prior tab when closing", () => {
  let tabs = emptyWorkspaceTabs();
  tabs = openWorkspaceTab(tabs, "left", "pdf-a");
  tabs = openWorkspaceTab(tabs, "left", "pdf-b");
  tabs = openWorkspaceTab(tabs, "left", "pdf-a");
  assert.deepEqual(tabs.left.openIds, ["pdf-a", "pdf-b"]);
  tabs = closeWorkspaceTab(tabs, "left", "pdf-a");
  assert.equal(tabs.left.activeId, "pdf-b");
});

test("removing a document closes it in both editors", () => {
  let tabs = emptyWorkspaceTabs();
  tabs = openWorkspaceTab(tabs, "left", "pdf-a");
  tabs = openWorkspaceTab(tabs, "right", "pdf-b");
  tabs = openWorkspaceTab(tabs, "right", "pdf-a");
  tabs = removeWorkspaceDocumentTabs(tabs, "pdf-a");
  assert.deepEqual(tabs.left, { openIds: [], activeId: null });
  assert.deepEqual(tabs.right, { openIds: ["pdf-b"], activeId: "pdf-b" });
});

test("a new workspace opens its Review Table as an editor document", () => {
  const tabs = initialWorkspaceTabs("workspace-a");
  assert.equal(tabs.left.activeId, null);
  assert.deepEqual(tabs.right, {
    openIds: [reviewTableId("workspace-a")],
    activeId: reviewTableId("workspace-a"),
  });
});

test("Review Table and PDF can stay open in opposite editors", () => {
  let tabs = initialWorkspaceTabs("workspace-a");
  tabs = openWorkspaceTab(tabs, "left", "pdf-a");
  assert.equal(tabs.left.activeId, "pdf-a");
  assert.equal(tabs.right.activeId, reviewTableId("workspace-a"));
  tabs = openWorkspaceTab(tabs, "right", "pdf-a");
  assert.deepEqual(tabs.right.openIds, [reviewTableId("workspace-a"), "pdf-a"]);
  tabs = closeWorkspaceTab(tabs, "right", "pdf-a");
  assert.equal(tabs.right.activeId, reviewTableId("workspace-a"));
});

test("migrates a previously open bottom table into an editor tab", () => {
  const previous = openWorkspaceTab(emptyWorkspaceTabs(), "right", "pdf-a");
  const restored = restoreReviewTableTabs(previous, "workspace-a", true);
  assert.deepEqual(restored.right.openIds, ["pdf-a", reviewTableId("workspace-a")]);
  assert.equal(restored.right.activeId, reviewTableId("workspace-a"));
  assert.deepEqual(previous.right.openIds, ["pdf-a"]);
});
