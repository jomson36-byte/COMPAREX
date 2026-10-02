import type { WorkspaceLink } from "./workspaceLinks.mts";

type TableMark = {
  id: string;
  side: "tor" | "catalog";
  linkId?: string;
  manual?: boolean;
};

type EvidenceLocation = { documentId?: string; fileName: string };

export function evidenceTargetForCell<T extends { kind: string }>(
  rows: readonly T[],
  cell: readonly [number, number] | undefined,
): T | null {
  if (!cell || cell[0] !== 3) return null;
  const row = rows[cell[1]];
  return row?.kind === "requirement" ? row : null;
}

export function nextRequirementRowId<T extends { kind: string; mark: { id: string } }>(
  rows: readonly T[],
  currentId: string,
): string | null {
  const currentIndex = rows.findIndex((row) => row.kind === "requirement" && row.mark.id === currentId);
  if (currentIndex < 0) return null;
  return rows.slice(currentIndex + 1).find((row) => row.kind === "requirement")?.mark.id ?? null;
}

export function evidenceCellSummary(evidence: EvidenceLocation[]) {
  if (!evidence.length) return "";
  const fileCount = new Set(evidence.map((item) => item.documentId || item.fileName)).size;
  return `${evidence.length} หลักฐาน · ${fileCount} ไฟล์`;
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
