export const legacyWorkspaceKey = "comparex.workspace.v1";
export const workspaceIndexKey = "comparex.workspaces.v2";

export type WorkspaceSummary = {
  id: string;
  name: string;
  savedAt: string;
};

export type WorkspaceIndex = {
  version: 2;
  activeId: string | null;
  items: WorkspaceSummary[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const workspaceStateKey = (id: string) => `comparex.workspace.v2.${id}`;
export const workspaceHandleKey = (workspaceId: string, documentId: string) =>
  `workspace:${workspaceId}:document:${documentId}`;

export function readWorkspaceIndex(
  storage: StorageLike,
  createId: () => string,
  now: () => string,
): WorkspaceIndex {
  const saved = storage.getItem(workspaceIndexKey);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as WorkspaceIndex;
      if (parsed.version === 2 && Array.isArray(parsed.items)) {
        const items = parsed.items.filter(
          (item) =>
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.savedAt === "string",
        );
        return {
          version: 2,
          activeId: items.some((item) => item.id === parsed.activeId)
            ? parsed.activeId
            : null,
          items,
        };
      }
    } catch {
      // The existing index is preserved so a malformed record is not overwritten.
      throw new Error("The saved workspace list could not be read.");
    }
    throw new Error("The saved workspace list has an unsupported format.");
  }

  const index: WorkspaceIndex = { version: 2, activeId: null, items: [] };
  const legacy = storage.getItem(legacyWorkspaceKey);
  if (legacy) {
    let parsed: { version?: number; workspaceName?: string; savedAt?: string };
    try {
      parsed = JSON.parse(legacy);
    } catch {
      throw new Error("The existing project could not be read. It was not changed.");
    }
    if (parsed.version !== 1) {
      throw new Error("The existing project uses an unsupported format. It was not changed.");
    }
    const id = createId();
    index.activeId = id;
    index.items.push({
      id,
      name: parsed.workspaceName?.trim() || "Untitled workspace",
      savedAt: parsed.savedAt || now(),
    });
    storage.setItem(workspaceStateKey(id), legacy);
  }

  storage.setItem(workspaceIndexKey, JSON.stringify(index));
  if (legacy) storage.removeItem(legacyWorkspaceKey);
  return index;
}

export function saveWorkspaceIndex(storage: StorageLike, index: WorkspaceIndex) {
  storage.setItem(workspaceIndexKey, JSON.stringify(index));
}
