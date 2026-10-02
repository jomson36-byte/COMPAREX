export type WorkspaceLink = {
  id: string;
  sourceId: string;
  targetId: string;
};

export function addWorkspaceLink(
  current: WorkspaceLink[],
  sourceId: string,
  targetId: string,
  createId: () => string,
) {
  if (sourceId === targetId || current.some((link) =>
    (link.sourceId === sourceId && link.targetId === targetId) ||
    (link.sourceId === targetId && link.targetId === sourceId),
  )) return current;
  return [...current, { id: createId(), sourceId, targetId }];
}

export function removeWorkspaceLinksForItems(current: WorkspaceLink[], itemIds: ReadonlySet<string>) {
  return current.filter((link) =>
    !itemIds.has(link.sourceId) && !itemIds.has(link.targetId),
  );
}

export function removeWorkspaceLinkBetween(current: WorkspaceLink[], firstId: string, secondId: string) {
  return current.filter((link) =>
    !((link.sourceId === firstId && link.targetId === secondId) ||
      (link.targetId === firstId && link.sourceId === secondId)),
  );
}
