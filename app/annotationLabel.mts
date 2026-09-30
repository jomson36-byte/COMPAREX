export type NormalizedPoint = { x: number; y: number };

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
  const homeX = clamp(anchor.x * pageWidth, pageWidth - width);
  const homeY = clamp(anchor.y * pageHeight - height, pageHeight - height);
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
