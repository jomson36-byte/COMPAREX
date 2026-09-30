import type { PDFDocument, PDFFont, PDFImage, PDFPage } from "pdf-lib";
import type { EvidenceMark } from "./PdfPreview";
import {
  annotationLabelFont,
  annotationLabelFontStyle,
  getAnnotationLabelLayout,
} from "./annotationLabel.mts";

type Anchor = NonNullable<EvidenceMark["annotation"]>;
type PdfLibModule = typeof import("pdf-lib");
type PreparedLabel =
  | { kind: "font"; textWidth: number; fontSize: number }
  | { kind: "image"; textWidth: number; fontSize: number; image: PDFImage };

export type PdfAnnotation = {
  mark: EvidenceMark;
  requirementNo?: string;
  anchor: Anchor;
};

async function prepareLabel(
  pdf: PDFDocument,
  font: PDFFont,
  label: string,
  pageWidth: number,
  cache: Map<string, PreparedLabel>,
): Promise<PreparedLabel> {
  const fontSize = annotationLabelFont(pageWidth);
  const cacheKey = `${label}:${fontSize}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not render the annotation label.");
  context.font = annotationLabelFontStyle(fontSize);
  const textWidth = context.measureText(label).width;

  try {
    font.widthOfTextAtSize(label, fontSize);
    const prepared: PreparedLabel = {
      kind: "font",
      textWidth,
      fontSize,
    };
    cache.set(cacheKey, prepared);
    return prepared;
  } catch {
    // Standard PDF fonts cannot encode Thai digits. Render only that label as an image.
    const textHeight = fontSize * 1.25;
    const scale = 4;
    canvas.width = Math.ceil(textWidth * scale);
    canvas.height = Math.ceil(textHeight * scale);
    context.scale(scale, scale);
    context.font = annotationLabelFontStyle(fontSize);
    context.textBaseline = "alphabetic";
    context.fillStyle = "#eff6ff";
    context.fillText(label, 0, textHeight - fontSize * 0.16);

    const prepared: PreparedLabel = {
      kind: "image",
      textWidth,
      fontSize,
      image: await pdf.embedPng(canvas.toDataURL("image/png")),
    };
    cache.set(cacheKey, prepared);
    return prepared;
  }
}

async function drawAnnotation(
  pdfLib: PdfLibModule,
  pdf: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  labelCache: Map<string, PreparedLabel>,
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
  const label = `#${requirementNo}`;
  const preparedLabel = await prepareLabel(pdf, font, label, width, labelCache);
  const layout = getAnnotationLabelLayout({
    pageWidth: width,
    pageHeight: height,
    textWidth: preparedLabel.textWidth,
    anchor: labelAnchor,
    position: mark.labelPosition,
    offset: mark.labelOffset,
  });
  const x = cropX + layout.x;
  const y = cropY + height - layout.y - layout.height;

  page.drawRectangle({
    x,
    y,
    width: layout.width,
    height: layout.height,
    color: rgb(29 / 255, 78 / 255, 216 / 255),
  });
  if (preparedLabel.kind === "image") {
    page.drawImage(preparedLabel.image, {
      x: x + layout.paddingX,
      y: y + layout.paddingY,
      width: preparedLabel.textWidth,
      height: layout.fontSize * 1.25,
    });
  } else {
    page.drawText(label, {
      x: x + layout.paddingX,
      y: y + layout.paddingY + layout.fontSize * 0.16,
      size: layout.fontSize,
      font,
      color: rgb(239 / 255, 246 / 255, 1),
    });
  }
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
  const labelCache = new Map<string, PreparedLabel>();
  if (title) pdf.setTitle(title);

  for (const annotation of annotations) {
    const { mark } = annotation;
    if (mark.page < 1 || mark.page > pageCount) continue;
    await drawAnnotation(pdfLib, pdf, pdf.getPage(mark.page - 1), font, labelCache, annotation);
  }

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
  const labelCache = new Map<string, PreparedLabel>();
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

      for (const annotation of annotationsByPage.get(pageNumber) ?? []) {
        await drawAnnotation(pdfLib, outputPdf, outputPage, font, labelCache, annotation);
      }
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
