"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  create,
  PDFSlick,
} from "@pdfslick/core";
import type { PDFException, PDFSlickOptions } from "@pdfslick/core";
import { createStore, PDFSlickViewer } from "@pdfslick/react";
import { Highlighter, Link2, MessageSquare } from "lucide-react";

type AreaRect = { x: number; y: number; width: number; height: number };
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
  side: "tor" | "catalog";
  fileName: string;
  fileUrl?: string;
  page: number;
  text: string;
  note?: string;
  linkId?: string;
  area?: AreaRect;
  annotation?: DocumentPoint;
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
  marks,
  requirementNumberByLinkId,
  renderAnnotations = true,
  onCreateMark,
}: {
  file: File;
  url: string;
  sourceUrl?: string;
  side: "tor" | "catalog";
  pendingLinkId: string | null;
  interactionMode: "highlight" | "link";
  marks: EvidenceMark[];
  requirementNumberByLinkId?: ReadonlyMap<string, string>;
  renderAnnotations?: boolean;
  onCreateMark: (mark: EvidenceMark, intent: "highlight" | "link") => void;
}) {
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
    if (!isDocumentLoaded || !container || !renderAnnotations) return;

    const restoreHighlights = window.setTimeout(() => {
      container
        .querySelectorAll("[data-requirement-reference], [data-area-mark], [data-annotation-canvas]")
        .forEach((element) => element.remove());

      const canvases = new Map<HTMLElement, CanvasRenderingContext2D>();
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
        const requirementNo = mark.linkId ? requirementNumberByLinkId?.get(mark.linkId) : undefined;
        const anchor = mark.annotation ?? (mark.area ? { x: mark.area.x, y: mark.area.y } : undefined);
        if (!requirementNo || !anchor) return;
        const labelAnchor = mark.area ? anchor : anchor.rects?.[0] ?? anchor;
        const fontSize = Math.max(10, width * 0.015);
        context.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
        const label = `#${requirementNo}`;
        const paddingX = fontSize * 0.45;
        const paddingY = fontSize * 0.28;
        const labelWidth = context.measureText(label).width + paddingX * 2;
        const labelHeight = fontSize * 1.25 + paddingY * 2;
        const x = Math.min(Math.max(labelAnchor.x * width, 0), width - labelWidth);
        const y = Math.max(labelAnchor.y * height - labelHeight, 0);
        context.fillStyle = "#1d4ed8";
        context.fillRect(x, y, labelWidth, labelHeight);
        context.fillStyle = "#eff6ff";
        context.fillText(label, x + paddingX, y + labelHeight - paddingY - fontSize * 0.16);
      };

      for (const mark of marks) {
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
        const isReady = mark.area
          ? Boolean(container.querySelector(`[data-area-mark="${mark.id}"]`))
          : rangesRef.current.has(mark.id);
        if (isReady) {
          window.dispatchEvent(
            new CustomEvent("comparex:mark-ready", { detail: mark.id }),
          );
        }
      }
    }, 100);

    return () => window.clearTimeout(restoreHighlights);
  }, [container, isDocumentLoaded, marks, renderAnnotations, requirementNumberByLinkId, scale, side]);

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
          intent === "link" && side === "catalog"
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
    if (interactionMode === "link" && side === "tor") {
      commitMark(nextSelection, "link");
    } else if (side === "catalog" && pendingLinkId) {
      commitMark(nextSelection, "link");
    } else {
      setSelection(nextSelection);
    }
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
      if (interactionMode === "link" && side === "tor") {
        commitMark(nextSelection, "link");
      } else if (side === "catalog" && pendingLinkId) {
        commitMark(nextSelection, "link");
      } else {
        setSelection(nextSelection);
      }
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
        if (isActive) setIsDocumentLoaded(true);
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
      const id = (event as CustomEvent<string>).detail;
      const area = container?.querySelector<HTMLElement>(`[data-area-mark="${id}"]`);
      const range = rangesRef.current.get(id);
      const target =
        range?.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range?.startContainer.parentElement;
      (area ?? target)?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("comparex:jump-to-mark", jumpToMark);
    return () => window.removeEventListener("comparex:jump-to-mark", jumpToMark);
  }, [container]);

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
            aria-label={side === "tor" ? "Start evidence link" : "Link selected evidence"}
            title={side === "tor" ? "Link evidence" : "Link to TOR"}
            disabled={side === "catalog" && !pendingLinkId}
          >
            <Link2 aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const note = window.prompt("Note for this evidence");
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
