import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyWorkspaceKey,
  readWorkspaceIndex,
  workspaceHandleKey,
  workspaceIndexKey,
  workspaceStateKey,
} from "../app/workspaceStore.mts";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("starts with an empty workspace list", () => {
  const data = storage();
  const index = readWorkspaceIndex(data, () => "id-1", () => "2026-10-02");
  assert.deepEqual(index, { version: 2, activeId: null, items: [] });
  assert.equal(JSON.parse(data.getItem(workspaceIndexKey)).version, 2);
});

test("migrates a saved project without dropping its review state", () => {
  const legacy = {
    version: 1,
    workspaceName: "Meeting room",
    savedAt: "2026-09-30",
    marks: [{ id: "mark-1", fileName: "tor.pdf" }],
    files: { torName: "tor.pdf", evidenceNames: ["catalog.pdf"] },
  };
  const data = storage({ [legacyWorkspaceKey]: JSON.stringify(legacy) });
  const index = readWorkspaceIndex(data, () => "id-1", () => "2026-10-02");
  assert.equal(index.activeId, "id-1");
  assert.equal(index.items[0].name, "Meeting room");
  assert.deepEqual(JSON.parse(data.getItem(workspaceStateKey("id-1"))), legacy);
  assert.equal(data.getItem(legacyWorkspaceKey), null);
});

test("leaves the old project untouched if migration cannot be saved", () => {
  const original = JSON.stringify({ version: 1, workspaceName: "Original" });
  const data = storage({ [legacyWorkspaceKey]: original });
  data.setItem = () => {
    throw new Error("quota exceeded");
  };
  assert.throws(() => readWorkspaceIndex(data, () => "id-1", () => "today"));
  assert.equal(data.getItem(legacyWorkspaceKey), original);
});

test("uses document IDs for independent handle keys", () => {
  assert.notEqual(
    workspaceHandleKey("workspace-a", "document-a"),
    workspaceHandleKey("workspace-b", "document-a"),
  );
});
