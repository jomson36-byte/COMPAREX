import type { EvidenceMark } from "./PdfPreview";

type Anchor = NonNullable<EvidenceMark["annotation"]>;

export type PdfAnnotation = {
  mark: EvidenceMark;
  requirementNo?: string;
  anchor: Anchor;
};

export async function createAnnotatedPdf(
  file: File,
  annotations: PdfAnnotation[],
): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  annotations.forEach(({ mark, requirementNo, anchor }) => {
    const page = pdf.getPage(mark.page - 1);
    if (!page) return;

    const { x: cropX, y: cropY, width, height } = page.getCropBox();
    const highlightRects = mark.area ? [mark.area] : anchor.rects ?? [];
    highlightRects.forEach((rect) => {
      const x = cropX + rect.x * width;
      const y = cropY + height - (rect.y + rect.height) * height;
      const rectWidth = rect.width * width;
      const rectHeight = rect.height * height;
      const isAreaMark = Boolean(mark.area);
      page.drawRectangle({
        x,
        y,
        width: rectWidth,
        height: rectHeight,
        color: rgb(0.23, 0.51, 0.96),
        opacity: isAreaMark ? 0.23 : 0.32,
        borderColor: isAreaMark ? rgb(0.23, 0.51, 0.96) : undefined,
        borderWidth: isAreaMark ? 1.2 : undefined,
        borderDashArray: isAreaMark ? [3, 2] : undefined,
      });
      if (!isAreaMark) {
        page.drawLine({
          start: { x, y },
          end: { x: x + rectWidth, y },
          thickness: 1.2,
          color: rgb(0.23, 0.51, 0.96),
        });
      }
    });

    if (!requirementNo) return;
    const labelAnchor = mark.area ? anchor : anchor.rects?.[0] ?? anchor;
    const fontSize = 9;
    const label = `#${requirementNo}`;
    const paddingX = 4;
    const paddingY = 3;
    const labelWidth = font.widthOfTextAtSize(label, fontSize) + paddingX * 2;
    const labelHeight = fontSize + paddingY * 2;
    const homeX = Math.min(
      Math.max(cropX + labelAnchor.x * width, cropX),
      cropX + width - labelWidth,
    );
    const homeTop = Math.min(
      Math.max(labelAnchor.y * height - labelHeight, 0),
      height - labelHeight,
    );
    const x = mark.labelPosition
      ? Math.min(
          Math.max(cropX + mark.labelPosition.x * width, cropX),
          cropX + width - labelWidth,
        )
      : Math.min(
          Math.max(homeX + (mark.labelOffset?.x ?? 0) * width, cropX),
          cropX + width - labelWidth,
        );
    const y = mark.labelPosition
      ? Math.min(
          Math.max(cropY + height - mark.labelPosition.y * height - labelHeight, cropY),
          cropY + height - labelHeight,
        )
      : cropY + height - Math.min(
          Math.max(homeTop + (mark.labelOffset?.y ?? 0) * height, 0),
          height - labelHeight,
        ) - labelHeight;
    page.drawRectangle({
      x,
      y,
      width: labelWidth,
      height: labelHeight,
      color: rgb(0.11, 0.31, 0.85),
    });
    page.drawText(label, {
      x: x + paddingX,
      y: y + paddingY,
      size: fontSize,
      font,
      color: rgb(1, 1, 1),
    });
  });

  return new Blob([Uint8Array.from(await pdf.save()).buffer], {
    type: "application/pdf",
  });
}
