export type NormalizedPoint = { x: number; y: number };
export type AnnotationRect = { x: number; y: number; width: number; height: number };

type LabelPlacement = {
  pageWidth: number;
  pageHeight: number;
  textWidth: number;
  anchor: NormalizedPoint;
  position?: NormalizedPoint;
  offset?: NormalizedPoint;
};

export const annotationLabelFont = (pageWidth: number) =>
  Math.max(1, pageWidth * 0.015);

export const annotationLabelFontStyle = (fontSize: number) =>
  `700 ${fontSize}px Arial, Helvetica, sans-serif`;

export function getAnnotationLabelLayout({
  pageWidth,
  pageHeight,
  textWidth,
  anchor,
  position,
  offset,
}: LabelPlacement) {
  const fontSize = annotationLabelFont(pageWidth);
  const paddingX = fontSize * 0.45;
  const paddingY = fontSize * 0.28;
  const width = textWidth + paddingX * 2;
  const height = fontSize * 1.25 + paddingY * 2;
  const clamp = (value: number, maximum: number) =>
    Math.min(Math.max(value, 0), Math.max(0, maximum));
  const homeX = clamp(anchor.x * pageWidth - width, pageWidth - width);
  const homeY = clamp(anchor.y * pageHeight, pageHeight - height);
  const x = clamp(
    position ? position.x * pageWidth : homeX + (offset?.x ?? 0) * pageWidth,
    pageWidth - width,
  );
  const y = clamp(
    position ? position.y * pageHeight : homeY + (offset?.y ?? 0) * pageHeight,
    pageHeight - height,
  );

  return { x, y, width, height, fontSize, paddingX, paddingY, homeX, homeY };
}

function overlapArea(first: AnnotationRect, second: AnnotationRect) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return width * height;
}

export function getAnnotationLabelConnector(
  label: AnnotationRect,
  anchor: AnnotationRect,
): { start: NormalizedPoint; end: NormalizedPoint } | null {
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum);
  const anchorCenter = {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height / 2,
  };
  const start = {
    x: clamp(anchorCenter.x, label.x, label.x + label.width),
    y: clamp(anchorCenter.y, label.y, label.y + label.height),
  };
  const end = {
    x: clamp(start.x, anchor.x, anchor.x + anchor.width),
    y: clamp(start.y, anchor.y, anchor.y + anchor.height),
  };
  return Math.hypot(start.x - end.x, start.y - end.y) > Math.max(0.5, label.height * 0.08)
    ? { start, end }
    : null;
}

export function findAutomaticAnnotationLabelPosition({
  pageWidth,
  pageHeight,
  labelWidth,
  labelHeight,
  anchor,
  obstacles,
  occupied,
  inkFraction,
}: {
  pageWidth: number;
  pageHeight: number;
  labelWidth: number;
  labelHeight: number;
  anchor: AnnotationRect;
  obstacles: readonly AnnotationRect[];
  occupied: readonly AnnotationRect[];
  inkFraction?: (rect: AnnotationRect) => number;
}): { x: number; y: number } {
  const gap = Math.max(3, labelHeight * 0.2);
  const home = { x: anchor.x - labelWidth, y: anchor.y };
  const left = anchor.x - labelWidth - gap;
  const right = anchor.x + anchor.width + gap;
  const above = anchor.y - labelHeight - gap;
  const below = anchor.y + anchor.height + gap;
  const candidates = [
    home,
    { x: anchor.x + anchor.width, y: anchor.y },
    { x: anchor.x, y: anchor.y - labelHeight },
    { x: anchor.x, y: anchor.y + anchor.height },
    { x: left, y: anchor.y },
    { x: right, y: anchor.y },
    { x: anchor.x, y: below },
    { x: anchor.x + anchor.width - labelWidth, y: above },
    { x: anchor.x + anchor.width - labelWidth, y: below },
    { x: left, y: anchor.y + anchor.height / 2 - labelHeight / 2 },
    { x: right, y: anchor.y + anchor.height / 2 - labelHeight / 2 },
    { x: left, y: above },
    { x: left, y: below },
  ];
  const clamp = (value: number, maximum: number) => Math.min(Math.max(value, 0), Math.max(0, maximum));
  const maxDistance = Math.min(pageWidth, pageHeight) * 0.14;
  const labelArea = Math.max(1, labelWidth * labelHeight);
  const origin = { x: clamp(home.x, pageWidth - labelWidth), y: clamp(home.y, pageHeight - labelHeight) };
  let best = origin;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const rect = {
      x: clamp(candidate.x, pageWidth - labelWidth),
      y: clamp(candidate.y, pageHeight - labelHeight),
      width: labelWidth,
      height: labelHeight,
    };
    const distance = Math.hypot(rect.x - origin.x, rect.y - origin.y);
    if (distance > maxDistance && candidate !== home) continue;
    const contentOverlap = obstacles.reduce((total, obstacle) => total + overlapArea(rect, obstacle), 0) / labelArea;
    const badgeOverlap = occupied.reduce((total, badge) => total + overlapArea(rect, badge), 0) / labelArea;
    const ink = Math.min(1, Math.max(0, inkFraction?.(rect) ?? 0));
    const score = contentOverlap * 80 + badgeOverlap * 160 + ink * 80 + distance / Math.max(1, maxDistance) * 3;
    if (score < bestScore) {
      best = { x: rect.x, y: rect.y };
      bestScore = score;
    }
  }
  return best;
}
