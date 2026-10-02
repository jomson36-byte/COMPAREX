export type Slot = "left" | "right";
export type PaneTabs = { openIds: string[]; activeId: string | null };
export type WorkspaceTabs = Record<Slot, PaneTabs>;

export const emptyWorkspaceTabs = (): WorkspaceTabs => ({
  left: { openIds: [], activeId: null },
  right: { openIds: [], activeId: null },
});

export const reviewTableId = (workspaceId: string) => `review-table:${workspaceId}`;

export const initialWorkspaceTabs = (workspaceId: string): WorkspaceTabs => ({
  ...emptyWorkspaceTabs(),
  right: { openIds: [reviewTableId(workspaceId)], activeId: reviewTableId(workspaceId) },
});

export const restoreReviewTableTabs = (tabs: WorkspaceTabs, workspaceId: string, wasTableOpen: boolean) =>
  wasTableOpen ? openWorkspaceTab(tabs, "right", reviewTableId(workspaceId)) : tabs;

export function openWorkspaceTab(tabs: WorkspaceTabs, slot: Slot, documentId: string): WorkspaceTabs {
  return {
    ...tabs,
    [slot]: {
      openIds: tabs[slot].openIds.includes(documentId)
        ? tabs[slot].openIds
        : [...tabs[slot].openIds, documentId],
      activeId: documentId,
    },
  };
}

export function closeWorkspaceTab(tabs: WorkspaceTabs, slot: Slot, documentId: string): WorkspaceTabs {
  const openIds = tabs[slot].openIds.filter((id) => id !== documentId);
  return {
    ...tabs,
    [slot]: {
      openIds,
      activeId: tabs[slot].activeId === documentId
        ? openIds.at(-1) ?? null
        : tabs[slot].activeId,
    },
  };
}

export function removeWorkspaceDocumentTabs(tabs: WorkspaceTabs, documentId: string): WorkspaceTabs {
  return closeWorkspaceTab(closeWorkspaceTab(tabs, "left", documentId), "right", documentId);
}
