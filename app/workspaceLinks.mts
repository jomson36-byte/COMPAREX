export type WorkspaceLink = {
  id: string;
  sourceId: string;
  targetId: string;
  column?: number;
};

const connects = (link: WorkspaceLink, firstId: string, secondId: string) =>
  (link.sourceId === firstId && link.targetId === secondId) ||
  (link.sourceId === secondId && link.targetId === firstId);

export function workspaceLinkColumn(current: readonly WorkspaceLink[], firstId: string, secondId: string): number | undefined {
  const column = current.find((link) => connects(link, firstId, secondId))?.column;
  return typeof column === "number" && Number.isInteger(column) && column > 0 ? column : undefined;
}

export function addWorkspaceLink(
  current: WorkspaceLink[],
  sourceId: string,
  targetId: string,
  createId: () => string,
  column?: number,
) {
  if (sourceId === targetId) return current;
  if (current.some((link) => connects(link, sourceId, targetId))) {
    return column === undefined ? current : current.map((link) =>
      connects(link, sourceId, targetId) ? { ...link, column } : link,
    );
  }
  return [...current, { id: createId(), sourceId, targetId, ...(column === undefined ? {} : { column }) }];
}

export function removeWorkspaceLinksForItems(current: WorkspaceLink[], itemIds: ReadonlySet<string>) {
  return current.filter((link) =>
    !itemIds.has(link.sourceId) && !itemIds.has(link.targetId),
  );
}

export function removeWorkspaceLinkBetween(current: WorkspaceLink[], firstId: string, secondId: string) {
  return current.filter((link) => !connects(link, firstId, secondId));
}
