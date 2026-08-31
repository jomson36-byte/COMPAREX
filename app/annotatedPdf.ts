import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import type { EvidenceMark } from "./PdfPreview";

type Anchor = NonNullable<EvidenceMark["annotation"]>;
type PdfLibModule = typeof import("pdf-lib");

export type PdfAnnotation = {
  mark: EvidenceMark;
  requirementNo?: string;
  anchor: Anchor;
};

function drawAnnotation(
  pdfLib: PdfLibModule,
  page: PDFPage,
  font: PDFFont,
  annotation: PdfAnnotation,
) {
  const { rgb } = pdfLib;
  const { mark, requirementNo, anchor } = annotation;
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
    : cropY +
      height -
      Math.min(
        Math.max(homeTop + (mark.labelOffset?.y ?? 0) * height, 0),
        height - labelHeight,
      ) -
      labelHeight;

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
}

async function createDirectAnnotatedPdf(
  file: File,
  annotations: PdfAnnotation[],
  pdfLib: PdfLibModule,
  title?: string,
) {
  const { PDFDocument, StandardFonts } = pdfLib;
  const pdf = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pageCount = pdf.getPageCount();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  if (title) pdf.setTitle(title);

  annotations.forEach((annotation) => {
    const { mark } = annotation;
    if (mark.page < 1 || mark.page > pageCount) return;
    drawAnnotation(pdfLib, pdf.getPage(mark.page - 1), font, annotation);
  });

  return new Blob([Uint8Array.from(await pdf.save()).buffer], {
    type: "application/pdf",
  });
}

async function createRasterizedAnnotatedPdf(
  file: File,
  annotations: PdfAnnotation[],
  pdfLib: PdfLibModule,
  title?: string,
) {
  const pdfjs = await import("pdfjs-dist/legacy/webpack.mjs");
  const { PDFDocument, StandardFonts } = pdfLib;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const sourcePdf = await loadingTask.promise;
  const outputPdf = await PDFDocument.create();
  const font = await outputPdf.embedFont(StandardFonts.HelveticaBold);
  if (title) outputPdf.setTitle(title);
  const annotationsByPage = new Map<number, PdfAnnotation[]>();

  annotations.forEach((annotation) => {
    const pageAnnotations = annotationsByPage.get(annotation.mark.page) ?? [];
    pageAnnotations.push(annotation);
    annotationsByPage.set(annotation.mark.page, pageAnnotations);
  });

  try {
    for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
      const sourcePage = await sourcePdf.getPage(pageNumber);
      const baseViewport = sourcePage.getViewport({ scale: 1 });
      const renderScale = Math.min(2.5, window.devicePixelRatio || 2);
      const renderViewport = sourcePage.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("Could not create a canvas for PDF rendering.");

      await sourcePage.render({
        canvas,
        canvasContext,
        viewport: renderViewport,
      }).promise;

      const imageBytes = await new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error("Could not render a PDF page image."));
            return;
          }
          resolve(new Uint8Array(await blob.arrayBuffer()));
        }, "image/png");
      });
      const image = await outputPdf.embedPng(imageBytes);
      const outputPage = outputPdf.addPage([
        baseViewport.width,
        baseViewport.height,
      ]);

      outputPage.drawImage(image, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });

      (annotationsByPage.get(pageNumber) ?? []).forEach((annotation) => {
        drawAnnotation(pdfLib, outputPage, font, annotation);
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return new Blob([Uint8Array.from(await outputPdf.save()).buffer], {
    type: "application/pdf",
  });
}

export async function createAnnotatedPdf(
  file: File,
  annotations: PdfAnnotation[],
  title?: string,
): Promise<Blob> {
  const pdfLib = await import("pdf-lib");

  try {
    return await createDirectAnnotatedPdf(file, annotations, pdfLib, title);
  } catch (error) {
    try {
      return await createRasterizedAnnotatedPdf(file, annotations, pdfLib, title);
    } catch (fallbackError) {
      const originalMessage =
        error instanceof Error ? error.message : "direct PDF annotation failed";
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : "raster fallback failed";
      throw new Error(`${originalMessage}; fallback failed: ${fallbackMessage}`);
    }
  }
}
