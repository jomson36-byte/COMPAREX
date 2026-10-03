import { workspaceLinkColumn, type WorkspaceLink } from "./workspaceLinks.mts";
import { columnLinkColor, type LinkColor } from "./linkColors.mts";

type TableMark = {
  id: string;
  side: "tor" | "catalog";
  linkId?: string;
  manual?: boolean;
};

export function linkTargetForCell<T extends { kind: string; links?: readonly unknown[] }>(
  rows: readonly T[],
  cell: readonly [number, number] | undefined,
  linkColumnCount: number,
): T | null {
  if (!cell || cell[0] < 2 || cell[0] >= 2 + linkColumnCount) return null;
  const row = rows[cell[1]];
  return row?.kind === "requirement" && !tableLinkAtColumn(row.links ?? [], cell[0]) ? row : null;
}

export function tableLinkAtColumn<T>(links: readonly T[], column: number): T | undefined {
  if (column < 2) return undefined;
  const positioned = links.some((link) =>
    typeof link === "object" && link !== null && "column" in link,
  );
  return positioned
    ? links.find((link) => typeof link === "object" && link !== null && "column" in link && link.column === column - 1)
    : links[column - 2];
}

export function nextAvailableLinkColumn(links: readonly { column: number }[], preferred?: number): number {
  const occupied = new Set(links.map((link) => link.column));
  if (preferred && preferred > 0 && !occupied.has(preferred)) return preferred;
  let column = 1;
  while (occupied.has(column)) column += 1;
  return column;
}

export function tableLinkSlotsForRow<T extends TableMark>(
  marks: T[],
  row: T,
  links: WorkspaceLink[],
): Array<{ mark: T; column: number }> {
  const evidence = tableEvidenceForRow(marks, row, links);
  const used = new Set<number>();
  const assigned = new Map<string, number>();
  for (const mark of evidence) {
    const column = workspaceLinkColumn(links, row.id, mark.id);
    if (!column || used.has(column)) continue;
    assigned.set(mark.id, column);
    used.add(column);
  }
  for (const mark of evidence) {
    if (assigned.has(mark.id)) continue;
    let column = 1;
    while (used.has(column)) column += 1;
    assigned.set(mark.id, column);
    used.add(column);
  }
  return evidence.map((mark) => ({ mark, column: assigned.get(mark.id)! }))
    .sort((first, second) => first.column - second.column);
}

export function colorsByTableColumns<T extends TableMark>(
  marks: T[],
  rows: T[],
  links: WorkspaceLink[],
  columnColors: Readonly<Record<string, LinkColor>>,
): Map<string, LinkColor[]> {
  const colors = new Map<string, LinkColor[]>();
  for (const row of rows) {
    for (const { mark, column } of tableLinkSlotsForRow(marks, row, links)) {
      const color = columnLinkColor(columnColors, column);
      const linkedColors = colors.get(mark.id) ?? [];
      if (!linkedColors.includes(color)) linkedColors.push(color);
      colors.set(mark.id, linkedColors);
    }
  }
  return colors;
}

export function nextRequirementRowId<T extends { kind: string; mark: { id: string } }>(
  rows: readonly T[],
  currentId: string,
): string | null {
  const currentIndex = rows.findIndex((row) => row.kind === "requirement" && row.mark.id === currentId);
  if (currentIndex < 0) return null;
  return rows.slice(currentIndex + 1).find((row) => row.kind === "requirement")?.mark.id ?? null;
}

export function tableRowMovePreview<T extends { kind: string }>(
  rows: readonly T[],
  sourceIndex: number,
  targetIndex: number,
  selectedIndexes: readonly number[] = [sourceIndex],
): { valid: boolean; edge: "top" | "bottom" } {
  const source = rows[sourceIndex];
  const target = rows[targetIndex];
  return {
    valid: source?.kind === "requirement" && target?.kind === "requirement" &&
      !selectedIndexes.includes(targetIndex),
    edge: sourceIndex < targetIndex ? "bottom" : "top",
  };
}

export function selectedRowGroups(indexes: readonly number[]): Array<{ start: number; end: number }> {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const groups: Array<{ start: number; end: number }> = [];
  for (const index of sorted) {
    const last = groups.at(-1);
    if (last && index === last.end + 1) last.end = index;
    else groups.push({ start: index, end: index });
  }
  return groups;
}

export function isRowBorderGrabPoint(
  point: { x: number; y: number },
  border: { x: number; y: number; width: number; height: number },
  tolerance = 6,
): boolean {
  const right = border.x + border.width;
  const bottom = border.y + border.height;
  if (point.x < border.x - tolerance || point.x > right + tolerance ||
      point.y < border.y - tolerance || point.y > bottom + tolerance) return false;
  return Math.abs(point.x - border.x) <= tolerance ||
    Math.abs(point.x - right) <= tolerance ||
    Math.abs(point.y - border.y) <= tolerance ||
    Math.abs(point.y - bottom) <= tolerance;
}

export function moveTableRows<T extends { id: string }>(
  items: readonly T[],
  sourceIds: readonly string[],
  targetId: string,
  isTableRow: (item: T) => boolean,
  edge: "before" | "after",
): T[] {
  const tableRows = items.filter(isTableRow);
  const sourceSet = new Set(sourceIds);
  const moving = tableRows.filter((row) => sourceSet.has(row.id));
  if (!moving.length || moving.length !== sourceSet.size || sourceSet.has(targetId)) return [...items];
  const remaining = tableRows.filter((row) => !sourceSet.has(row.id));
  const targetIndex = remaining.findIndex((row) => row.id === targetId);
  if (targetIndex < 0) return [...items];
  remaining.splice(targetIndex + (edge === "after" ? 1 : 0), 0, ...moving);
  let rowIndex = 0;
  return items.map((item) => isTableRow(item) ? remaining[rowIndex++] : item);
}

export function tableEvidenceForRow<T extends TableMark>(
  marks: T[],
  row: T,
  links: WorkspaceLink[],
): T[] {
  return marks.filter((mark) => !mark.manual && mark.id !== row.id && (
    (mark.side === "catalog" && Boolean(row.linkId) && mark.linkId === row.linkId) ||
    links.some((link) =>
      (link.sourceId === row.id && link.targetId === mark.id) ||
      (link.targetId === row.id && link.sourceId === mark.id),
    )
  ));
}

export function requirementNumbersByEvidenceMark<T extends TableMark>(
  marks: T[],
  rows: ReadonlyArray<{ mark: T; number: string }>,
  links: WorkspaceLink[],
): Map<string, string[]> {
  const rowIds = new Set(rows.map(({ mark }) => mark.id));
  const numbersByMarkId = new Map<string, string[]>();
  for (const { mark: row, number } of rows) {
    const trimmedNumber = number.trim();
    if (!trimmedNumber) continue;
    for (const evidence of tableEvidenceForRow(marks, row, links)) {
      if (rowIds.has(evidence.id)) continue;
      const numbers = numbersByMarkId.get(evidence.id) ?? [];
      if (!numbers.includes(trimmedNumber)) numbers.push(trimmedNumber);
      numbersByMarkId.set(evidence.id, numbers);
    }
  }
  return numbersByMarkId;
}

export function unassignedTableHighlights<T extends TableMark>(
  highlights: T[],
  rowIds: ReadonlySet<string>,
  pairedLegacyIds: ReadonlySet<string>,
  links: WorkspaceLink[],
): T[] {
  return highlights.filter((mark) =>
    !rowIds.has(mark.id) &&
    !(mark.linkId && pairedLegacyIds.has(mark.linkId)) &&
    !links.some((link) =>
      (link.sourceId === mark.id && rowIds.has(link.targetId)) ||
      (link.targetId === mark.id && rowIds.has(link.sourceId)),
    ),
  );
}
