"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  annotationLabelFont,
  annotationLabelFontStyle,
  findAutomaticAnnotationLabelPosition,
  getAnnotationLabelConnector,
  getAnnotationLabelLayout,
} from "./annotationLabel.mts";
import type { AnnotationRect } from "./annotationLabel.mts";
import {
  create,
  PDFSlick,
} from "@pdfslick/core";
import type { PDFException, PDFSlickOptions } from "@pdfslick/core";
import { createStore, PDFSlickViewer } from "@pdfslick/react";
import { Highlighter, Link2, MessageSquare } from "lucide-react";
import { selectionAction } from "./highlightIntent.mts";
import { linkColorStyle, resolveLinkColor, type LinkColor } from "./linkColors.mts";
import { anchoredRequirementTextPosition, clampRequirementTextPosition, clampRequirementTextScale, layoutRequirementText, resizedRequirementTextScale, type RequirementTextPlacement } from "./requirementText.mts";

type AreaRect = { x: number; y: number; width: number; height: number };

function sourcePageCanvas(page: HTMLElement) {
  return page.querySelector<HTMLCanvasElement>(".canvasWrapper canvas") ??
    page.querySelector<HTMLCanvasElement>("canvas:not(.page-annotation-canvas)");
}

function renderedInkFraction(page: HTMLElement, rect: AnnotationRect) {
  const canvas = sourcePageCanvas(page);
  const context = canvas?.getContext("2d");
  if (!canvas || !context || !canvas.width || !canvas.height) return 0;
  const pageBounds = page.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  if (!canvasBounds.width || !canvasBounds.height) return 0;
  const pixelX = Math.max(0, Math.floor((pageBounds.left + rect.x - canvasBounds.left) * canvas.width / canvasBounds.width));
  const pixelY = Math.max(0, Math.floor((pageBounds.top + rect.y - canvasBounds.top) * canvas.height / canvasBounds.height));
  const pixelWidth = Math.min(canvas.width - pixelX, Math.ceil(rect.width * canvas.width / canvasBounds.width));
  const pixelHeight = Math.min(canvas.height - pixelY, Math.ceil(rect.height * canvas.height / canvasBounds.height));
  if (pixelWidth <= 0 || pixelHeight <= 0) return 0;
  try {
    const { data } = context.getImageData(pixelX, pixelY, pixelWidth, pixelHeight);
    let ink = 0;
    let samples = 0;
    for (let y = 0; y < pixelHeight; y += 3) {
      for (let x = 0; x < pixelWidth; x += 3) {
        const index = (y * pixelWidth + x) * 4;
        samples += 1;
        if (data[index + 3] > 32 && (data[index] + data[index + 1] + data[index + 2]) / 3 < 245) ink += 1;
      }
    }
    return samples ? ink / samples : 0;
  } catch {
    return 0;
  }
}
type DocumentPoint = {
  x: number;
  y: number;
  rects?: AreaRect[];
};
type MarkSelection = {
  range?: Range;
  area?: AreaRect;
  annotation?: DocumentPoint;
  text: string;
  page: number;
  x: number;
  y: number;
};

export type EvidenceMark = {
  id: string;
  documentId?: string;
  reviewRole?: "highlight" | "requirement";
  side: "tor" | "catalog";
  fileName: string;
  fileUrl?: string;
  page: number;
  text: string;
  note?: string;
  linkId?: string;
  area?: AreaRect;
  annotation?: DocumentPoint;
  labelPosition?: DocumentPoint;
  labelOffset?: DocumentPoint;
  referenceOnly?: boolean;
  manual?: boolean;
  parentId?: string;
  requirementNo?: string;
  color?: LinkColor;
};

export default function PdfPreview({
  file,
  url,
  sourceUrl,
  side,
  pendingLinkId,
  interactionMode,
  evidenceTargetRowId,
  marks,
  requirementNumberByLinkId,
  requirementNumbersByMarkId,
  colorsByMarkId,
  textPlacements = [],
  textPlacementTarget,
  onPlaceText,
  onMoveTextPlacement,
  onRemoveTextPlacement,
  renderAnnotations = true,
  onMoveMark,
  onAutoPlaceMark,
  onCreateMark,
  neutralLinking = false,
  onStatusChange,
  initialView,
  onViewChange,
}: {
  file: File;
  url: string;
  sourceUrl?: string;
  side: "tor" | "catalog";
  pendingLinkId: string | null;
  interactionMode: "highlight" | "link";
  evidenceTargetRowId?: string | null;
  marks: EvidenceMark[];
  requirementNumberByLinkId?: ReadonlyMap<string, string>;
  requirementNumbersByMarkId?: ReadonlyMap<string, readonly string[]>;
  colorsByMarkId?: ReadonlyMap<string, readonly LinkColor[]>;
  textPlacements?: RequirementTextPlacement[];
  textPlacementTarget?: { rowId: string; text: string } | null;
  onPlaceText?: (page: number, x: number, y: number) => boolean;
  onMoveTextPlacement?: (id: string, x: number, y: number, scale?: number) => void;
  onRemoveTextPlacement?: (id: string) => void;
  renderAnnotations?: boolean;
  onMoveMark?: (
    id: string,
    position: DocumentPoint,
    offset: DocumentPoint,
  ) => void;
  onAutoPlaceMark?: (id: string, position: DocumentPoint) => void;
  onCreateMark: (mark: EvidenceMark, intent: "highlight" | "link") => void;
  neutralLinking?: boolean;
  onStatusChange?: (status: "opening" | "ready" | "error", pageCount?: number, message?: string) => void;
  initialView?: { page: number; scale: number };
  onViewChange?: (view: { page: number; scale: number }) => void;
}) {
  const initialViewRef = useRef(initialView);
  const viewerNodeRef = useRef<HTMLElement | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<PDFException | null>(null);
  const [isDocumentLoaded, setIsDocumentLoaded] = useState(false);
  const [selection, setSelection] = useState<MarkSelection | null>(null);
  const [areaDraft, setAreaDraft] = useState<{
    page: number;
    bounds: DOMRect;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const rangesRef = useRef(new Map<string, Range>());
  const areaJustFinishedRef = useRef(false);
  const textPointerRef = useRef<{ pointerId: number; page: number; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const placingTextRef = useRef(false);
  const keyboardStampFocusRef = useRef<string | null>(null);

  useEffect(() => {
    setSelection(null);
  }, [evidenceTargetRowId]);
  useEffect(() => {
    placingTextRef.current = false;
    textPointerRef.current = null;
    setSelection(null);
    setAreaDraft(null);
  }, [textPlacementTarget?.rowId]);
  const store = useMemo(() => create(), []);
  const usePDFSlickStore = useMemo(() => createStore(store), [store]);
  const options = useMemo<PDFSlickOptions>(
    () => ({
      enableHWA: true,
      enableOptimizedPartialRendering: true,
      filename: file.name,
      minDurationToUpdateCanvas: 180,
      removePageBorders: true,
      scaleValue: "page-width",
      useOnlyCssZoom: true,
    }),
    [file.name],
  );
  const viewerRef = useCallback((node: HTMLElement | null) => {
    // PDFSlickViewer recreates its callback ref on render, including a transient null detach.
    if (!node || viewerNodeRef.current === node) return;
    viewerNodeRef.current = node;
    setContainer(node);
  }, []);
  const numPages = usePDFSlickStore((state) => state.numPages);
  const pageNumber = usePDFSlickStore((state) => state.pageNumber);
  const pdfSlick = usePDFSlickStore((state) => state.pdfSlick);
  const scale = usePDFSlickStore((state) => state.scale);

  useEffect(() => {
    if (error) onStatusChange?.("error", undefined, error.message);
    else if (isDocumentLoaded && numPages) onStatusChange?.("ready", numPages);
    else onStatusChange?.("opening");
  }, [error, isDocumentLoaded, numPages, onStatusChange]);

  useEffect(() => {
    if (isDocumentLoaded && numPages && pageNumber > 0 && Number.isFinite(scale) && scale > 0) {
      onViewChange?.({ page: pageNumber, scale });
    }
  }, [isDocumentLoaded, numPages, pageNumber, scale, onViewChange]);

  useEffect(() => {
    if (!isDocumentLoaded || !container || !renderAnnotations) return;

    const restoreHighlights = window.setTimeout(() => {
      container
        .querySelectorAll(
          "[data-requirement-reference], [data-area-mark], [data-annotation-canvas], [data-annotation-badge-hit], [data-requirement-text]",
        )
        .forEach((element) => element.remove());

      const canvases = new Map<HTMLElement, CanvasRenderingContext2D>();
      const occupiedLabels = new Map<HTMLElement, AnnotationRect[]>();
      const obstaclesByPage = new Map<HTMLElement, AnnotationRect[]>();
      const contentObstacles = (page: HTMLElement) => {
        const cached = obstaclesByPage.get(page);
        if (cached) return cached;
        const pageBounds = page.getBoundingClientRect();
        const textRects = Array.from(page.querySelectorAll<HTMLElement>(".textLayer span"))
          .map((span) => span.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            x: rect.left - pageBounds.left,
            y: rect.top - pageBounds.top,
            width: rect.width,
            height: rect.height,
          }));
        const highlightRects = marks
          .filter((item) => item.page === Number(page.dataset.pageNumber))
          .flatMap((item) => item.area ? [item.area] : item.annotation?.rects ?? [])
          .map((rect) => ({
            x: rect.x * pageBounds.width,
            y: rect.y * pageBounds.height,
            width: rect.width * pageBounds.width,
            height: rect.height * pageBounds.height,
          }));
        const obstacles = [...textRects, ...highlightRects];
        obstaclesByPage.set(page, obstacles);
        return obstacles;
      };
      const drawAnnotation = (mark: EvidenceMark, page: HTMLElement, rects: AreaRect[]) => {
        if (!rects.length) return;
        let context = canvases.get(page);
        if (!context) {
          const canvas = document.createElement("canvas");
          const ratio = window.devicePixelRatio || 1;
          canvas.className = "page-annotation-canvas";
          canvas.dataset.annotationCanvas = "true";
          canvas.width = Math.round(page.clientWidth * ratio);
          canvas.height = Math.round(page.clientHeight * ratio);
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          page.appendChild(canvas);
          const canvasContext = canvas.getContext("2d");
          if (!canvasContext) return;
          context = canvasContext;
          context.scale(ratio, ratio);
          canvases.set(page, context);
        }
        const { width, height } = page.getBoundingClientRect();
        const isAreaMark = Boolean(mark.area);
        const colors = (colorsByMarkId?.get(mark.id)?.length
          ? colorsByMarkId.get(mark.id)!
          : [resolveLinkColor(mark.color)]).map(linkColorStyle);
        const primaryColor = colors[0];
        context.fillStyle = `rgb(${primaryColor.rgb.join(" ")} / ${isAreaMark ? "23%" : "32%"})`;
        context.lineWidth = isAreaMark ? 2 : 1.2;
        rects.forEach((rect) => {
          const x = rect.x * width;
          const y = rect.y * height;
          const rectWidth = rect.width * width;
          const rectHeight = rect.height * height;
          context.fillRect(x, y, rectWidth, rectHeight);
          colors.forEach((color, index) => {
            context.strokeStyle = color.fill;
            if (isAreaMark) {
              const inset = index * 3;
              context.setLineDash([4, 3]);
              context.strokeRect(x + inset, y + inset, Math.max(0, rectWidth - inset * 2), Math.max(0, rectHeight - inset * 2));
              context.setLineDash([]);
            } else {
              context.beginPath();
              context.moveTo(x, y + rectHeight - index * 2);
              context.lineTo(x + rectWidth, y + rectHeight - index * 2);
              context.stroke();
            }
          });
        });
        const requirementNo = requirementNumbersByMarkId?.get(mark.id)?.join(" · #") ??
          (mark.linkId ? requirementNumberByLinkId?.get(mark.linkId) : undefined);
        const anchor = mark.annotation ?? (mark.area ? { x: mark.area.x, y: mark.area.y } : undefined);
        if (!requirementNo || !anchor) return;
        const labelAnchor = mark.area ?? anchor.rects?.find((rect) => rect.width > 0 && rect.height > 0) ?? anchor;
        const fontSize = annotationLabelFont(width);
        context.font = annotationLabelFontStyle(fontSize);
        const label = `#${requirementNo}`;
        const textWidth = context.measureText(label).width;
        const anchorRect = {
          x: labelAnchor.x * width,
          y: labelAnchor.y * height,
          width: ("width" in labelAnchor ? labelAnchor.width : 0) * width,
          height: ("height" in labelAnchor ? labelAnchor.height : 0) * height,
        };
        const preferredLayout = getAnnotationLabelLayout({
          pageWidth: width,
          pageHeight: height,
          textWidth,
          anchor: labelAnchor,
          position: mark.labelPosition,
          offset: mark.labelOffset,
        });
        const pageLabels = occupiedLabels.get(page) ?? [];
        const automaticPosition = !mark.labelPosition
          ? findAutomaticAnnotationLabelPosition({
              pageWidth: width,
              pageHeight: height,
              labelWidth: preferredLayout.width,
              labelHeight: preferredLayout.height,
              anchor: anchorRect,
              obstacles: contentObstacles(page),
              occupied: pageLabels,
              inkFraction: (rect) => renderedInkFraction(page, rect),
            })
          : null;
        const {
          x,
          y,
          width: labelWidth,
          height: labelHeight,
          paddingX,
          paddingY,
          homeX,
          homeY,
        } = automaticPosition ? getAnnotationLabelLayout({
          pageWidth: width,
          pageHeight: height,
          textWidth,
          anchor: labelAnchor,
          position: { x: automaticPosition.x / width, y: automaticPosition.y / height },
        }) : preferredLayout;
        pageLabels.push({ x, y, width: labelWidth, height: labelHeight });
        occupiedLabels.set(page, pageLabels);
        const connector = getAnnotationLabelConnector(
          { x, y, width: labelWidth, height: labelHeight },
          anchorRect,
        );
        if (connector) {
          context.beginPath();
          context.moveTo(connector.start.x, connector.start.y);
          context.lineTo(connector.end.x, connector.end.y);
          context.strokeStyle = primaryColor.badge;
          context.lineWidth = Math.max(1, width * 0.0014);
          context.stroke();
        }
        context.fillStyle = primaryColor.badge;
        context.fillRect(x, y, labelWidth, labelHeight);
        context.fillStyle = "#eff6ff";
        context.fillText(label, x + paddingX, y + labelHeight - paddingY - fontSize * 0.16);

        if (automaticPosition && onAutoPlaceMark) {
          onAutoPlaceMark(mark.id, { x: x / width, y: y / height });
        }

        if (!onMoveMark) return;

        // The annotation itself stays on the page canvas so it matches the print
        // output. This transparent button is only its interactive hit target.
        const badgeHitTarget = document.createElement("div");
        badgeHitTarget.className = "page-annotation-badge-hit";
        badgeHitTarget.dataset.annotationBadgeHit = mark.id;
        badgeHitTarget.setAttribute("role", "button");
        badgeHitTarget.tabIndex = 0;
        badgeHitTarget.setAttribute("aria-label", `Move requirement ${label}`);
        badgeHitTarget.style.left = `${x}px`;
        badgeHitTarget.style.top = `${y}px`;
        badgeHitTarget.style.width = `${labelWidth}px`;
        badgeHitTarget.style.height = `${labelHeight}px`;
        page.appendChild(badgeHitTarget);

        badgeHitTarget.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || !onMoveMark) return;
          event.preventDefault();
          event.stopPropagation();
          badgeHitTarget.setPointerCapture(event.pointerId);

          const startX = event.clientX;
          const startY = event.clientY;
          const initialX = x;
          const initialY = y;
          // Keep the reference close to its evidence. Pointer capture also keeps
          // this gesture bound to the page where it started.
          const maxDistance = Math.min(width, height) * 0.14;
          let nextX = initialX;
          let nextY = initialY;

          const move = (moveEvent: PointerEvent) => {
            const pageBounds = page.getBoundingClientRect();
            const pageX = Math.min(
              Math.max(initialX + moveEvent.clientX - startX, 0),
              pageBounds.width - labelWidth,
            );
            const pageY = Math.min(
              Math.max(initialY + moveEvent.clientY - startY, 0),
              pageBounds.height - labelHeight,
            );
            const offsetX = pageX - homeX;
            const offsetY = pageY - homeY;
            const distance = Math.hypot(offsetX, offsetY);
            const scale = distance > maxDistance ? maxDistance / distance : 1;
            nextX = homeX + offsetX * scale;
            nextY = homeY + offsetY * scale;
            badgeHitTarget.style.left = `${nextX}px`;
            badgeHitTarget.style.top = `${nextY}px`;
          };
          const finish = () => {
            badgeHitTarget.removeEventListener("pointermove", move);
            badgeHitTarget.removeEventListener("pointercancel", finish);
            try {
              badgeHitTarget.releasePointerCapture(event.pointerId);
            } catch {
              // The browser may already have released capture after a cancelled drag.
            }
            const pageBounds = page.getBoundingClientRect();
            onMoveMark(mark.id, {
              x: nextX / pageBounds.width,
              y: nextY / pageBounds.height,
            }, {
              x: (nextX - homeX) / pageBounds.width,
              y: (nextY - homeY) / pageBounds.height,
            });
          };
          badgeHitTarget.addEventListener("pointermove", move);
          badgeHitTarget.addEventListener("pointerup", finish, { once: true });
          badgeHitTarget.addEventListener("pointercancel", finish, { once: true });
        });
      };

      const orderedMarks = [...marks].sort((first, second) =>
        Number(Boolean(second.labelPosition)) - Number(Boolean(first.labelPosition)),
      );
      for (const mark of orderedMarks) {
        if (mark.area) {
          const page = container.querySelector<HTMLElement>(
            `.page[data-page-number="${mark.page}"]`,
          );
          if (!page) continue;
          drawAnnotation(mark, page, [mark.area]);
          continue;
        }
        const page = container.querySelector(
          `.page[data-page-number="${mark.page}"]`,
        );
        const textLayer = page?.querySelector(".textLayer");
        if (!textLayer) continue;

        const existingRange = rangesRef.current.get(mark.id);
        if (existingRange) {
          drawAnnotation(mark, page as HTMLElement, mark.annotation?.rects ?? []);
          continue;
        }

        const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let fullText = "";
        let node = walker.nextNode();
        while (node) {
          nodes.push(node as Text);
          fullText += node.textContent ?? "";
          node = walker.nextNode();
        }

        const start = fullText.indexOf(mark.text);
        if (start < 0) continue;
        const end = start + mark.text.length;
        let offset = 0;
        let startNode: Text | null = null;
        let endNode: Text | null = null;
        let startOffset = 0;
        let endOffset = 0;
        for (const textNode of nodes) {
          const nextOffset = offset + (textNode.textContent?.length ?? 0);
          if (!startNode && start >= offset && start <= nextOffset) {
            startNode = textNode;
            startOffset = start - offset;
          }
          if (end >= offset && end <= nextOffset) {
            endNode = textNode;
            endOffset = end - offset;
            break;
          }
          offset = nextOffset;
        }
        if (!startNode || !endNode) continue;

        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        rangesRef.current.set(mark.id, range);
        drawAnnotation(mark, page as HTMLElement, mark.annotation?.rects ?? []);
      }
      for (const placement of textPlacements) {
        const page = container.querySelector<HTMLElement>(`.page[data-page-number="${placement.page}"]`);
        if (!page) continue;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) continue;
        const pageWidth = page.clientWidth || page.getBoundingClientRect().width;
        const pageHeight = page.clientHeight || page.getBoundingClientRect().height;
        const placementScale = placement.scale ?? 1;
        const fontSize = pageWidth * 0.017 * placementScale;
        context.font = `${fontSize}px Arial, sans-serif`;
        let layout;
        try {
          layout = layoutRequirementText(
            placement.text, pageWidth, pageHeight,
            placement.x, placement.y, (value) => context.measureText(value).width,
            placementScale,
          );
        } catch {
          continue;
        }
        const stamp = document.createElement("div");
        stamp.className = "requirement-text-stamp";
        stamp.dataset.requirementText = placement.id;
        stamp.style.left = `${layout.left}px`;
        stamp.style.top = `${layout.top}px`;
        stamp.style.width = `${layout.width}px`;
        stamp.style.minHeight = `${layout.height}px`;
        stamp.style.fontFamily = "Arial, sans-serif";
        stamp.style.fontSize = `${layout.fontSize}px`;
        stamp.style.lineHeight = `${layout.lineHeight}px`;
        stamp.style.padding = `${layout.padding}px`;
        stamp.dataset.scale = String(placementScale);
        const content = document.createElement("span");
        content.className = "requirement-text-content";
        content.textContent = layout.lines.join("\n");
        stamp.appendChild(content);
        stamp.setAttribute("role", "group");
        stamp.setAttribute("aria-label", `Placed requirement text on page ${placement.page}. Drag or use arrow keys to move it. Drag a corner handle or press Alt plus Up or Down to resize it. Press Delete to remove it.`);
        stamp.tabIndex = 0;
        const resizeHandles = (["nw", "ne", "sw", "se"] as const).map((corner) => {
          const handle = document.createElement("span");
          handle.className = `requirement-text-resize-handle ${corner}`;
          handle.dataset.resizeCorner = corner;
          handle.setAttribute("aria-hidden", "true");
          stamp.appendChild(handle);
          return { handle, corner };
        });
        page.appendChild(stamp);
        if (onMoveTextPlacement) {
          const drawLayout = (nextLayout: ReturnType<typeof layoutRequirementText>, nextScale: number) => {
            stamp.style.left = `${nextLayout.left}px`;
            stamp.style.top = `${nextLayout.top}px`;
            stamp.style.width = `${nextLayout.width}px`;
            stamp.style.minHeight = `${nextLayout.height}px`;
            stamp.style.fontSize = `${nextLayout.fontSize}px`;
            stamp.style.lineHeight = `${nextLayout.lineHeight}px`;
            stamp.style.padding = `${nextLayout.padding}px`;
            stamp.dataset.scale = String(nextScale);
            content.textContent = nextLayout.lines.join("\n");
          };
          const sizedLayout = (nextScale: number, left: number, top: number) => {
            context.font = `${pageWidth * 0.017 * nextScale}px Arial, sans-serif`;
            return layoutRequirementText(
              placement.text, pageWidth, pageHeight,
              left / pageWidth, top / pageHeight,
              (value) => context.measureText(value).width,
              nextScale,
            );
          };
          for (const { handle, corner } of resizeHandles) {
            handle.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              stamp.setPointerCapture(event.pointerId);
              stamp.classList.add("resizing");
              const originalLeft = Number.parseFloat(stamp.style.left);
              const originalTop = Number.parseFloat(stamp.style.top);
              const originalWidth = stamp.offsetWidth;
              const originalHeight = stamp.offsetHeight;
              const originalScale = Number(stamp.dataset.scale) || 1;
              const startX = event.clientX;
              const startY = event.clientY;
              const pageBounds = page.getBoundingClientRect();
              const scaleX = pageBounds.width / pageWidth || 1;
              const scaleY = pageBounds.height / pageHeight || 1;
              let nextScale = originalScale;
              let nextLayout = sizedLayout(originalScale, originalLeft, originalTop);
              const move = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== event.pointerId) return;
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                const dx = (moveEvent.clientX - startX) / scaleX;
                const dy = (moveEvent.clientY - startY) / scaleY;
                const candidateScale = resizedRequirementTextScale(
                  originalScale, dx, dy, originalWidth, originalHeight, corner,
                );
                try {
                  const size = sizedLayout(candidateScale, 0, 0);
                  const position = anchoredRequirementTextPosition(
                    originalLeft, originalTop, originalWidth, originalHeight,
                    size.width, size.height, pageWidth, pageHeight, corner,
                  );
                  nextLayout = sizedLayout(candidateScale, position.left, position.top);
                  nextScale = candidateScale;
                  drawLayout(nextLayout, nextScale);
                } catch {
                  // Keep the last fitting size when a larger layout would exceed the page.
                }
              };
              const finish = (endEvent: PointerEvent) => {
                if (endEvent.pointerId !== event.pointerId) return;
                endEvent.preventDefault();
                endEvent.stopPropagation();
                stamp.classList.remove("resizing");
                stamp.removeEventListener("pointermove", move);
                stamp.removeEventListener("pointerup", finish);
                stamp.removeEventListener("pointercancel", finish);
                if (stamp.hasPointerCapture(event.pointerId)) stamp.releasePointerCapture(event.pointerId);
                if (endEvent.type === "pointercancel") {
                  drawLayout(sizedLayout(originalScale, originalLeft, originalTop), originalScale);
                } else if (Math.abs(nextScale - originalScale) > 0.005) {
                  onMoveTextPlacement(placement.id, nextLayout.left / pageWidth, nextLayout.top / pageHeight, nextScale);
                }
              };
              stamp.addEventListener("pointermove", move);
              stamp.addEventListener("pointerup", finish);
              stamp.addEventListener("pointercancel", finish);
            });
          }
          stamp.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || (event.target as Element).closest("[data-resize-corner]")) return;
            event.preventDefault();
            event.stopPropagation();
            stamp.setPointerCapture(event.pointerId);
            stamp.classList.add("dragging");
            const startX = event.clientX;
            const startY = event.clientY;
            const originalLeft = Number.parseFloat(stamp.style.left);
            const originalTop = Number.parseFloat(stamp.style.top);
            const pageBounds = page.getBoundingClientRect();
            const scaleX = pageBounds.width / pageWidth || 1;
            const scaleY = pageBounds.height / pageHeight || 1;
            let next = clampRequirementTextPosition(
              originalLeft, originalTop, pageWidth, pageHeight,
              stamp.offsetWidth, stamp.offsetHeight,
            );
            const move = (moveEvent: PointerEvent) => {
              if (moveEvent.pointerId !== event.pointerId) return;
              moveEvent.preventDefault();
              moveEvent.stopPropagation();
              next = clampRequirementTextPosition(
                originalLeft + (moveEvent.clientX - startX) / scaleX,
                originalTop + (moveEvent.clientY - startY) / scaleY,
                pageWidth, pageHeight,
                stamp.offsetWidth, stamp.offsetHeight,
              );
              stamp.style.left = `${next.left}px`;
              stamp.style.top = `${next.top}px`;
            };
            const finish = (endEvent: PointerEvent) => {
              if (endEvent.pointerId !== event.pointerId) return;
              endEvent.preventDefault();
              endEvent.stopPropagation();
              stamp.classList.remove("dragging");
              stamp.removeEventListener("pointermove", move);
              stamp.removeEventListener("pointerup", finish);
              stamp.removeEventListener("pointercancel", finish);
              if (stamp.hasPointerCapture(event.pointerId)) stamp.releasePointerCapture(event.pointerId);
              if (endEvent.type === "pointercancel") {
                stamp.style.left = `${originalLeft}px`;
                stamp.style.top = `${originalTop}px`;
              } else if (Math.hypot(next.left - originalLeft, next.top - originalTop) >= 1) {
                onMoveTextPlacement(placement.id, next.x, next.y);
              }
            };
            stamp.addEventListener("pointermove", move);
            stamp.addEventListener("pointerup", finish);
            stamp.addEventListener("pointercancel", finish);
          });
          stamp.addEventListener("keydown", (event) => {
            if (event.target !== stamp) return;
            if ((event.key === "Delete" || event.key === "Backspace") && onRemoveTextPlacement) {
              event.preventDefault();
              event.stopPropagation();
              onRemoveTextPlacement(placement.id);
              return;
            }
            if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              event.stopPropagation();
              const currentScale = Number(stamp.dataset.scale) || 1;
              const step = event.shiftKey ? 0.25 : 0.1;
              const nextScale = clampRequirementTextScale(currentScale + (event.key === "ArrowUp" ? step : -step));
              if (nextScale === currentScale) return;
              try {
                const nextLayout = sizedLayout(
                  nextScale,
                  Number.parseFloat(stamp.style.left),
                  Number.parseFloat(stamp.style.top),
                );
                drawLayout(nextLayout, nextScale);
                keyboardStampFocusRef.current = placement.id;
                onMoveTextPlacement(placement.id, nextLayout.left / pageWidth, nextLayout.top / pageHeight, nextScale);
              } catch {
                // Leave the current size in place when the text cannot fit on the page.
              }
              return;
            }
            const direction = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            }[event.key];
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 10 : 2;
            const next = clampRequirementTextPosition(
              Number.parseFloat(stamp.style.left) + direction[0] * step,
              Number.parseFloat(stamp.style.top) + direction[1] * step,
              pageWidth, pageHeight,
              stamp.offsetWidth, stamp.offsetHeight,
            );
            stamp.style.left = `${next.left}px`;
            stamp.style.top = `${next.top}px`;
            keyboardStampFocusRef.current = placement.id;
            onMoveTextPlacement(placement.id, next.x, next.y);
          });
        }
        if (keyboardStampFocusRef.current === placement.id) {
          stamp.focus();
          keyboardStampFocusRef.current = null;
        }
      }
      for (const placement of textPlacements) {
        window.dispatchEvent(new CustomEvent("comparex:placement-ready", { detail: { id: placement.id, side } }));
      }
      for (const mark of marks) {
        // A target page may be virtualized and not have a text range yet. The
        // caller can safely navigate as soon as this document is ready; the
        // jump handler will render the requested page before centring it.
        window.dispatchEvent(
          new CustomEvent("comparex:mark-ready", { detail: { id: mark.id, side } }),
        );
      }
    }, 100);

    return () => window.clearTimeout(restoreHighlights);
  }, [colorsByMarkId, container, isDocumentLoaded, marks, onAutoPlaceMark, onMoveMark, onMoveTextPlacement, onRemoveTextPlacement, pageNumber, renderAnnotations, requirementNumberByLinkId, requirementNumbersByMarkId, scale, side, textPlacements]);

  const commitMark = (
    candidate: MarkSelection,
    intent: "highlight" | "link",
    note?: string,
  ) => {
    const id = crypto.randomUUID();
    if (candidate.range) {
      const range = candidate.range.cloneRange();
      rangesRef.current.set(id, range);
    }

    onCreateMark(
      {
        id,
        side,
        fileName: file.name,
        fileUrl: sourceUrl ?? url,
        page: candidate.page,
        text: candidate.text,
        area: candidate.area,
        annotation:
          candidate.annotation ??
          (candidate.area ? { x: candidate.area.x, y: candidate.area.y } : undefined),
        note,
        linkId:
          !neutralLinking && intent === "link" && (side === "catalog" || side === "tor")
            ? pendingLinkId ?? undefined
            : undefined,
      },
      intent,
    );
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const createMark = (intent: "highlight" | "link", note?: string) => {
    if (selection) commitMark(selection, intent, note);
  };

  const commitSelectionOrShowToolbar = (candidate: MarkSelection) => {
    const action = selectionAction({
      interactionMode,
      neutralLinking,
      side,
      pendingLinkId,
      evidenceTargetRowId: evidenceTargetRowId ?? null,
    });
    if (action === "toolbar") setSelection(candidate);
    else commitMark(candidate, action);
  };

  const captureSelection = () => {
    if (textPlacementTarget) return;
    if (areaJustFinishedRef.current) {
      areaJustFinishedRef.current = false;
      return;
    }
    const current = window.getSelection();
    if (!current || current.isCollapsed || !current.rangeCount) {
      setSelection(null);
      return;
    }

    const range = current.getRangeAt(0);
    if (!container?.contains(range.commonAncestorContainer)) return;
    const text = current.toString().trim();
    if (!text) return;

    const element =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const pageElement = element?.closest(".page");
    const bounds = range.getBoundingClientRect();
    const pageBounds = pageElement?.getBoundingClientRect();
    const nextSelection: MarkSelection = {
      range: range.cloneRange(),
      text,
      page: Number(pageElement?.getAttribute("data-page-number")) || pageNumber,
      annotation:
        pageBounds && pageBounds.width && pageBounds.height
          ? {
              x: (bounds.left - pageBounds.left) / pageBounds.width,
              y: (bounds.top - pageBounds.top) / pageBounds.height,
              rects: Array.from(range.getClientRects()).map((rect) => ({
                x: (rect.left - pageBounds.left) / pageBounds.width,
                y: (rect.top - pageBounds.top) / pageBounds.height,
                width: rect.width / pageBounds.width,
                height: rect.height / pageBounds.height,
              })),
            }
          : undefined,
      x: Math.min(window.innerWidth - 210, Math.max(12, bounds.left)),
      y: Math.max(12, bounds.top - 46),
    };
    commitSelectionOrShowToolbar(nextSelection);
  };

  const startAreaSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (textPlacementTarget) return;
    if (event.button !== 0) return;
    const target = event.target as Element;
    const page = target.closest<HTMLElement>(".page");
    if (
      !page ||
      !container?.contains(page) ||
      Boolean(target.closest(".textLayer span, a, button, input, summary"))
    ) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    window.getSelection()?.removeAllRanges();
    const bounds = page.getBoundingClientRect();
    setSelection(null);
    setAreaDraft({
      page: Number(page.dataset.pageNumber) || pageNumber,
      bounds,
      startX: Math.min(bounds.right, Math.max(bounds.left, event.clientX)),
      startY: Math.min(bounds.bottom, Math.max(bounds.top, event.clientY)),
      currentX: event.clientX,
      currentY: event.clientY,
    });
  };

  const moveAreaSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!areaDraft) return;
    event.preventDefault();
    setAreaDraft((current) => current ? {
      ...current,
      currentX: Math.min(current.bounds.right, Math.max(current.bounds.left, event.clientX)),
      currentY: Math.min(current.bounds.bottom, Math.max(current.bounds.top, event.clientY)),
    } : null);
  };

  const finishAreaSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!areaDraft) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const left = Math.min(areaDraft.startX, areaDraft.currentX);
    const top = Math.min(areaDraft.startY, areaDraft.currentY);
    const width = Math.abs(areaDraft.currentX - areaDraft.startX);
    const height = Math.abs(areaDraft.currentY - areaDraft.startY);
    if (width >= 6 && height >= 6) {
      areaJustFinishedRef.current = true;
      const nextSelection: MarkSelection = {
        area: {
          x: (left - areaDraft.bounds.left) / areaDraft.bounds.width,
          y: (top - areaDraft.bounds.top) / areaDraft.bounds.height,
          width: width / areaDraft.bounds.width,
          height: height / areaDraft.bounds.height,
        },
        text: `Selected area · Page ${areaDraft.page}`,
        page: areaDraft.page,
        x: Math.min(window.innerWidth - 210, Math.max(12, left)),
        y: Math.max(12, top - 46),
      };
      commitSelectionOrShowToolbar(nextSelection);
    }
    setAreaDraft(null);
  };

  const placeTextAt = (pageNumberToPlace: number, x: number, y: number) => {
    if (!textPlacementTarget || !container || !onPlaceText) return false;
    const page = container.querySelector<HTMLElement>(`.page[data-page-number="${pageNumberToPlace}"]`);
    if (!page) return false;
    const { width, height } = page.getBoundingClientRect();
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return false;
    context.font = `${width * 0.017}px Arial, sans-serif`;
    try {
      layoutRequirementText(textPlacementTarget.text, width, height, x, y, (value) => context.measureText(value).width);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not place this text on the PDF page.");
      return false;
    }
    return onPlaceText(pageNumberToPlace, x, y);
  };

  const startTextPlacement = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!textPlacementTarget || event.button !== 0 || placingTextRef.current) return;
    const target = event.target as Element;
    if (target.closest("button, a, input, [data-annotation-badge-hit], [data-requirement-text]")) return;
    const page = target.closest<HTMLElement>(".page");
    if (!page || !container?.contains(page)) return;
    const bounds = page.getBoundingClientRect();
    textPointerRef.current = {
      pointerId: event.pointerId,
      page: Number(page.dataset.pageNumber) || pageNumber,
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      clientX: event.clientX,
      clientY: event.clientY,
    };
  };

  const finishTextPlacement = (event: React.PointerEvent<HTMLDivElement>) => {
    const candidate = textPointerRef.current;
    textPointerRef.current = null;
    if (!textPlacementTarget || !candidate || candidate.pointerId !== event.pointerId || placingTextRef.current) return;
    if (Math.hypot(event.clientX - candidate.clientX, event.clientY - candidate.clientY) > 5) return;
    placingTextRef.current = true;
    if (!placeTextAt(candidate.page, candidate.x, candidate.y)) placingTextRef.current = false;
  };

  useEffect(() => {
    if (!container) return;

    let slick: PDFSlick | null = null;
    let isActive = true;

    // Deferring initialization prevents React Strict Mode from creating two
    // PDFSlick instances in the same viewer during its development-only probe.
    const initialization = window.setTimeout(() => {
      slick = new PDFSlick({
        container: container as HTMLDivElement,
        store,
        options,
        onError: (nextError) => {
          if (isActive) setError(nextError);
        },
      });
      store.setState({ pdfSlick: slick });
      void slick.loadDocument(url, options).then(() => {
        if (isActive) {
          const view = initialViewRef.current;
          if (view?.scale && Number.isFinite(view.scale) && view.scale > 0) slick!.currentScale = view.scale;
          if (view?.page && Number.isInteger(view.page) && view.page > 0) slick!.gotoPage(view.page);
          setIsDocumentLoaded(true);
        }
      });
    }, 0);

    return () => {
      isActive = false;
      window.clearTimeout(initialization);
      if (!slick) return;

      slick.unbindEvents();
      slick._cleanup();
      CSS.highlights.delete(`comparex-${side}`);
      store.setState({ pdfSlick: null, isDocumentLoaded: false });
    };
  }, [container, options, side, store, url]);

  useEffect(() => {
    const jumpToMark = (event: Event) => {
      const detail = (event as CustomEvent<string | { id: string; side: "tor" | "catalog" }>).detail;
      const id = typeof detail === "string" ? detail : detail.id;
      if (typeof detail !== "string" && detail.side !== side) return;
      const mark = marks.find((item) => item.id === id);
      if (!mark || !container) return;

      // Text ranges are created only after a page is rendered. Navigate to the
      // source page first, then centre the precise highlight when it is ready.
      pdfSlick?.gotoPage(mark.page);
      window.setTimeout(() => {
        const page = container.querySelector<HTMLElement>(
          `.page[data-page-number="${mark.page}"]`,
        );
        const range = rangesRef.current.get(id);
        const target =
          range?.startContainer.nodeType === Node.ELEMENT_NODE
            ? (range.startContainer as Element)
            : range?.startContainer.parentElement;
        (target ?? page)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 120);
    };
    window.addEventListener("comparex:jump-to-mark", jumpToMark);
    return () => window.removeEventListener("comparex:jump-to-mark", jumpToMark);
  }, [container, marks, pdfSlick]);

  useEffect(() => {
    if (!container || !pdfSlick) return;
    const jumpToPlacement = (event: Event) => {
      const { id, side: targetSide } = (event as CustomEvent<{ id: string; side: "tor" | "catalog" }>).detail;
      if (targetSide !== side) return;
      const placement = textPlacements.find((item) => item.id === id);
      if (!placement) return;
      pdfSlick.gotoPage(placement.page);
      const selector = `[data-requirement-text="${CSS.escape(id)}"]`;
      const reveal = () => {
        const stamp = container.querySelector<HTMLElement>(selector);
        if (!stamp) return false;
        stamp.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        return true;
      };
      if (reveal()) return;
      const observer = new MutationObserver(() => {
        if (reveal()) observer.disconnect();
      });
      observer.observe(container, { childList: true, subtree: true });
      window.setTimeout(() => {
        observer.disconnect();
        if (!reveal()) container.querySelector<HTMLElement>(`.page[data-page-number="${placement.page}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 2000);
    };
    window.addEventListener("comparex:jump-to-placement", jumpToPlacement);
    return () => window.removeEventListener("comparex:jump-to-placement", jumpToPlacement);
  }, [container, pdfSlick, side, textPlacements]);

  useEffect(() => {
    const removeMark = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      container?.querySelector(`[data-area-mark="${id}"]`)?.remove();
      rangesRef.current.delete(id);
      CSS.highlights.set(
        `comparex-${side}`,
        new Highlight(...rangesRef.current.values()),
      );
    };
    window.addEventListener("comparex:remove-mark", removeMark);
    return () => window.removeEventListener("comparex:remove-mark", removeMark);
  }, [container, side]);

  return (
    <div
      className={`pdf-preview pdfSlick ${textPlacementTarget ? "placing-requirement-text" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onMouseUp={captureSelection}
      onPointerDown={(event) => { startTextPlacement(event); startAreaSelection(event); }}
      onPointerMove={moveAreaSelection}
      onPointerUp={(event) => { finishTextPlacement(event); finishAreaSelection(event); }}
      onPointerCancel={() => { textPointerRef.current = null; setAreaDraft(null); }}
    >
      <style>{`
        ::highlight(comparex-tor) {
          color: inherit;
          background: rgb(20 184 166 / 34%);
          text-decoration: underline 2px #14b8a6;
        }
        ::highlight(comparex-catalog) {
          color: inherit;
          background: rgb(59 130 246 / 32%);
          text-decoration: underline 2px #3b82f6;
        }
      `}</style>
      {areaDraft ? (
        <div
          className={`area-highlight-draft ${side}`}
          style={{
            left: Math.min(areaDraft.startX, areaDraft.currentX),
            top: Math.min(areaDraft.startY, areaDraft.currentY),
            width: Math.abs(areaDraft.currentX - areaDraft.startX),
            height: Math.abs(areaDraft.currentY - areaDraft.startY),
          }}
        />
      ) : null}
      {selection ? (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="Selected text actions"
          style={{ left: selection.x, top: selection.y }}
        >
          <button
            type="button"
            onClick={() => createMark("highlight")}
            aria-label="Highlight selected text"
            title="Highlight"
          >
            <Highlighter aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            onClick={() => createMark("link")}
            aria-label={neutralLinking ? "Link selected highlight" : side === "tor" ? "Start evidence link" : "Link selected evidence"}
            title={neutralLinking ? "Link highlight" : side === "tor" ? "Link evidence" : "Link to TOR"}
            disabled={!neutralLinking && side === "catalog" && !pendingLinkId}
          >
            <Link2 aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const note = window.prompt("Note for this highlight");
              if (note !== null) createMark("highlight", note.trim());
            }}
            aria-label="Add note to selected text"
            title="Add note"
          >
            <MessageSquare aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      <div className="preview-toolbar">
        <span>{numPages ? `${pageNumber} / ${numPages}` : "Preparing"}</span>
        <button
          type="button"
          onClick={() => pdfSlick?.decreaseScale()}
          disabled={!isDocumentLoaded}
          aria-label="Zoom out"
        >
          -
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => pdfSlick?.increaseScale()}
          disabled={!isDocumentLoaded}
          aria-label="Zoom in"
        >
          +
        </button>
        {textPlacementTarget ? (
          <button
            type="button"
            onClick={() => placeTextAt(pageNumber, 0.5, 0.5)}
            disabled={!isDocumentLoaded}
            aria-label="Place selected requirement text at the center of this PDF page"
          >
            Place text at center
          </button>
        ) : null}
      </div>

      <div className="pdf-canvas-wrap">
        {!isDocumentLoaded && !error ? (
          <p className="preview-status">Loading PDF...</p>
        ) : null}
        {error ? <p className="error-message">{error.message}</p> : null}
        <div className="pdf-slick-stage">
          <PDFSlickViewer
            viewerRef={viewerRef}
            usePDFSlickStore={usePDFSlickStore}
          />
        </div>
      </div>
    </div>
  );
}
