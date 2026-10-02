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

  useEffect(() => {
    setSelection(null);
  }, [evidenceTargetRowId]);
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
    if (node) setContainer(node);
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
          "[data-requirement-reference], [data-area-mark], [data-annotation-canvas], [data-annotation-badge-hit]",
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
        context.fillStyle = isAreaMark ? "rgb(59 130 246 / 23%)" : "rgb(59 130 246 / 32%)";
        context.strokeStyle = "#3b82f6";
        context.lineWidth = isAreaMark ? 2 : 1.2;
        rects.forEach((rect) => {
          const x = rect.x * width;
          const y = rect.y * height;
          const rectWidth = rect.width * width;
          const rectHeight = rect.height * height;
          context.fillRect(x, y, rectWidth, rectHeight);
          if (isAreaMark) {
            context.setLineDash([4, 3]);
            context.strokeRect(x, y, rectWidth, rectHeight);
            context.setLineDash([]);
          } else {
            context.beginPath();
            context.moveTo(x, y + rectHeight);
            context.lineTo(x + rectWidth, y + rectHeight);
            context.stroke();
          }
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
          context.strokeStyle = "#1d4ed8";
          context.lineWidth = Math.max(1, width * 0.0014);
          context.stroke();
        }
        context.fillStyle = "#1d4ed8";
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
  }, [container, isDocumentLoaded, marks, onAutoPlaceMark, onMoveMark, renderAnnotations, requirementNumberByLinkId, requirementNumbersByMarkId, scale, side]);

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
      className="pdf-preview pdfSlick"
      onClick={(event) => event.stopPropagation()}
      onMouseUp={captureSelection}
      onPointerDown={startAreaSelection}
      onPointerMove={moveAreaSelection}
      onPointerUp={finishAreaSelection}
      onPointerCancel={() => setAreaDraft(null)}
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
