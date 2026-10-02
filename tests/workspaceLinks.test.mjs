import assert from "node:assert/strict";
import test from "node:test";
import { addWorkspaceLink, removeWorkspaceLinkBetween, removeWorkspaceLinksForItems } from "../app/workspaceLinks.mts";

test("links highlights across files without creating duplicate or self links", () => {
  let links = addWorkspaceLink([], "highlight-a", "highlight-b", () => "link-1");
  assert.equal(links.length, 1);
  links = addWorkspaceLink(links, "highlight-b", "highlight-a", () => "link-2");
  links = addWorkspaceLink(links, "highlight-a", "highlight-a", () => "link-3");
  assert.equal(links.length, 1);
  assert.deepEqual(links[0], {
    id: "link-1", sourceId: "highlight-a", targetId: "highlight-b",
  });
});

test("removing a highlight removes only its related links", () => {
  const links = [
    { id: "a", sourceId: "highlight-a", targetId: "row-1" },
    { id: "b", sourceId: "highlight-b", targetId: "row-1" },
  ];
  assert.deepEqual(removeWorkspaceLinksForItems(links, new Set(["highlight-a"])), [links[1]]);
});

test("unlinking a table cell preserves the highlight's other relationships", () => {
  const links = [
    { id: "a", sourceId: "row-1", targetId: "highlight-a" },
    { id: "b", sourceId: "highlight-a", targetId: "row-2" },
    { id: "c", sourceId: "highlight-a", targetId: "highlight-b" },
  ];
  assert.deepEqual(removeWorkspaceLinkBetween(links, "highlight-a", "row-1"), [links[1], links[2]]);
});
