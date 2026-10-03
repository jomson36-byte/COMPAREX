import type { PDFDocument, PDFFont, PDFImage, PDFPage } from "pdf-lib";
import type { EvidenceMark } from "./PdfPreview";
import { linkColorStyle, resolveLinkColor, type LinkColor } from "./linkColors.mts";
import { layoutRequirementText, type RequirementTextPlacement } from "./requirementText.mts";
import {
  annotationLabelFont,
  annotationLabelFontStyle,
  getAnnotationLabelConnector,
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
  colors?: readonly LinkColor[];
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
  const colors = (annotation.colors?.length ? annotation.colors : [resolveLinkColor(mark.color)]).map(linkColorStyle);
  const primaryColor = colors[0];
  const pdfColor = (color: typeof primaryColor) => rgb(...color.rgb.map((channel) => channel / 255) as [number, number, number]);
  const badgeColor = rgb(...([1, 3, 5].map((index) => Number.parseInt(primaryColor.badge.slice(index, index + 2), 16) / 255) as [number, number, number]));
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
      color: pdfColor(primaryColor),
      opacity: isAreaMark ? 0.23 : 0.32,
    });
    colors.forEach((color, index) => {
      if (isAreaMark) {
        const inset = index * 2;
        page.drawRectangle({
          x: x + inset,
          y: y + inset,
          width: Math.max(0, rectWidth - inset * 2),
          height: Math.max(0, rectHeight - inset * 2),
          borderColor: pdfColor(color),
          borderWidth: 1.2,
          borderDashArray: [3, 2],
        });
      } else {
        page.drawLine({
          start: { x, y: y + index * 2 },
          end: { x: x + rectWidth, y: y + index * 2 },
          thickness: 1.2,
          color: pdfColor(color),
        });
      }
    });
  });

  if (!requirementNo) return;

  const labelAnchor = mark.area ?? anchor.rects?.find((rect) => rect.width > 0 && rect.height > 0) ?? anchor;
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

  const connector = getAnnotationLabelConnector(
    { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
    {
      x: labelAnchor.x * width,
      y: labelAnchor.y * height,
      width: ("width" in labelAnchor ? labelAnchor.width : 0) * width,
      height: ("height" in labelAnchor ? labelAnchor.height : 0) * height,
    },
  );
  if (connector) {
    page.drawLine({
      start: { x: cropX + connector.start.x, y: cropY + height - connector.start.y },
      end: { x: cropX + connector.end.x, y: cropY + height - connector.end.y },
      thickness: Math.max(0.6, width * 0.0014),
      color: badgeColor,
    });
  }

  page.drawRectangle({
    x,
    y,
    width: layout.width,
    height: layout.height,
    color: badgeColor,
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

async function drawRequirementText(
  pdf: PDFDocument,
  page: PDFPage,
  placement: RequirementTextPlacement,
) {
  const { x: cropX, y: cropY, width: pageWidth, height: pageHeight } = page.getCropBox();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not render placed requirement text.");
  context.font = `${pageWidth * 0.017 * (placement.scale ?? 1)}px Arial, sans-serif`;
  const layout = layoutRequirementText(
    placement.text, pageWidth, pageHeight, placement.x, placement.y,
    (value) => context.measureText(value).width,
    placement.scale ?? 1,
  );
  const ratio = 3;
  canvas.width = Math.ceil(layout.width * ratio);
  canvas.height = Math.ceil(layout.height * ratio);
  context.scale(ratio, ratio);
  context.fillStyle = "#111827";
  context.font = `${layout.fontSize}px Arial, sans-serif`;
  context.textBaseline = "alphabetic";
  layout.lines.forEach((line, index) => {
    context.fillText(line, layout.padding, layout.padding + layout.fontSize + index * layout.lineHeight);
  });
  const image = await pdf.embedPng(canvas.toDataURL("image/png"));
  page.drawImage(image, {
    x: cropX + layout.left,
    y: cropY + pageHeight - layout.top - layout.height,
    width: layout.width,
    height: layout.height,
  });
}

async function createDirectAnnotatedPdf(
  file: File,
  annotations: PdfAnnotation[],
  pdfLib: PdfLibModule,
  title?: string,
  textPlacements: RequirementTextPlacement[] = [],
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
  for (const placement of textPlacements) {
    if (placement.page < 1 || placement.page > pageCount) continue;
    await drawRequirementText(pdf, pdf.getPage(placement.page - 1), placement);
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
  textPlacements: RequirementTextPlacement[] = [],
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
  const placementsByPage = new Map<number, RequirementTextPlacement[]>();
  textPlacements.forEach((placement) => {
    const onPage = placementsByPage.get(placement.page) ?? [];
    onPage.push(placement);
    placementsByPage.set(placement.page, onPage);
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
      for (const placement of placementsByPage.get(pageNumber) ?? []) {
        await drawRequirementText(outputPdf, outputPage, placement);
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
  textPlacements: RequirementTextPlacement[] = [],
): Promise<Blob> {
  const pdfLib = await import("pdf-lib");

  try {
    return await createDirectAnnotatedPdf(file, annotations, pdfLib, title, textPlacements);
  } catch (error) {
    try {
      return await createRasterizedAnnotatedPdf(file, annotations, pdfLib, title, textPlacements);
    } catch (fallbackError) {
      const originalMessage =
        error instanceof Error ? error.message : "direct PDF annotation failed";
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : "raster fallback failed";
      throw new Error(`${originalMessage}; fallback failed: ${fallbackMessage}`);
    }
  }
}
