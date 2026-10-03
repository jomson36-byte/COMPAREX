export type RequirementTextPlacement = {
  id: string;
  rowId: string;
  documentId: string;
  page: number;
  x: number;
  y: number;
  text: string;
  scale?: number;
};

export function removeRequirementTextPlacements(
  placements: readonly RequirementTextPlacement[], rowIds: readonly string[],
): RequirementTextPlacement[] {
  const selectedRows = new Set(rowIds);
  return placements.filter((placement) => !selectedRows.has(placement.rowId));
}

export const MIN_REQUIREMENT_TEXT_SCALE = 0.5;
export const MAX_REQUIREMENT_TEXT_SCALE = 3;

export function clampRequirementTextScale(scale: number) {
  return Math.max(MIN_REQUIREMENT_TEXT_SCALE, Math.min(MAX_REQUIREMENT_TEXT_SCALE, scale));
}

export type RequirementTextResizeCorner = "nw" | "ne" | "sw" | "se";

export function resizedRequirementTextScale(
  scale: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
  corner: RequirementTextResizeCorner,
) {
  const horizontalChange = (corner.endsWith("e") ? dx : -dx) / Math.max(1, width);
  const verticalChange = (corner.startsWith("s") ? dy : -dy) / Math.max(1, height);
  const change = Math.abs(horizontalChange) >= Math.abs(verticalChange) ? horizontalChange : verticalChange;
  return clampRequirementTextScale(scale * (1 + change));
}

export function anchoredRequirementTextPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  nextWidth: number,
  nextHeight: number,
  pageWidth: number,
  pageHeight: number,
  corner: RequirementTextResizeCorner,
) {
  return clampRequirementTextPosition(
    corner.endsWith("w") ? left + width - nextWidth : left,
    corner.startsWith("n") ? top + height - nextHeight : top,
    pageWidth, pageHeight, nextWidth, nextHeight,
  );
}

export function sanitizeRequirementTextPlacements(value: unknown): RequirementTextPlacement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const placement = item as Partial<RequirementTextPlacement>;
    if (typeof placement.id !== "string" || !placement.id ||
      typeof placement.rowId !== "string" || !placement.rowId ||
      typeof placement.documentId !== "string" || !placement.documentId ||
      typeof placement.text !== "string" || !placement.text.trim() || placement.text.length > 2000 ||
      !Number.isInteger(placement.page) || (placement.page ?? 0) < 1 ||
      !Number.isFinite(placement.x) || !Number.isFinite(placement.y) ||
      (placement.x ?? -1) < 0 || (placement.x ?? 2) > 1 ||
      (placement.y ?? -1) < 0 || (placement.y ?? 2) > 1) return [];
    const scale = typeof placement.scale === "number" && Number.isFinite(placement.scale)
      ? clampRequirementTextScale(placement.scale)
      : undefined;
    return [{
      id: placement.id,
      rowId: placement.rowId,
      documentId: placement.documentId,
      page: placement.page!,
      x: placement.x!,
      y: placement.y!,
      text: placement.text,
      ...(scale === undefined ? {} : { scale }),
    }];
  });
}

export function latestRequirementTextPlacement(
  placements: readonly RequirementTextPlacement[], rowId: string,
): RequirementTextPlacement | undefined {
  return placements.findLast((placement) => placement.rowId === rowId);
}

type MeasureText = (text: string) => number;

export function clampRequirementTextPosition(
  left: number,
  top: number,
  pageWidth: number,
  pageHeight: number,
  boxWidth: number,
  boxHeight: number,
) {
  const safeLeft = Math.max(0, Math.min(Math.max(0, pageWidth - boxWidth), left));
  const safeTop = Math.max(0, Math.min(Math.max(0, pageHeight - boxHeight), top));
  return { left: safeLeft, top: safeTop, x: safeLeft / pageWidth, y: safeTop / pageHeight };
}

export function layoutRequirementText(
  text: string,
  pageWidth: number,
  pageHeight: number,
  x: number,
  y: number,
  measureText: MeasureText,
  scale = 1,
) {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    throw new Error("The PDF page has no usable dimensions.");
  }
  if (!Number.isFinite(scale) || scale < MIN_REQUIREMENT_TEXT_SCALE || scale > MAX_REQUIREMENT_TEXT_SCALE) {
    throw new Error("The placed text size is invalid.");
  }
  const fontSize = pageWidth * 0.017 * scale;
  const padding = fontSize * 0.7;
  const wrapWidth = pageWidth * 0.94;
  const lineHeight = fontSize * 1.45;
  const contentWidth = wrapWidth - padding * 2;
  const lines: string[] = [];
  const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" });
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const { segment: character } of graphemes.segment(paragraph)) {
      if (line && measureText(line + character) > contentWidth) {
        lines.push(line.trimEnd());
        line = character.trimStart();
      } else {
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  const width = Math.min(wrapWidth, Math.max(0, ...lines.map(measureText)) + padding * 2 + 8);
  const height = lines.length * lineHeight + padding * 2;
  if (height > pageHeight * 0.9) {
    throw new Error("Requirement text is too long to fit on one PDF page.");
  }
  const position = clampRequirementTextPosition(
    x * pageWidth, y * pageHeight, pageWidth, pageHeight, width, height,
  );
  return {
    lines,
    fontSize,
    padding,
    lineHeight,
    width,
    height,
    left: position.left,
    top: position.top,
  };
}
