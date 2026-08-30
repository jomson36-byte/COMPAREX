"use client";

import { usePDFSlick } from "@pdfslick/react";

export default function PdfPreview({
  file,
  url,
}: {
  file: File;
  url: string;
}) {
  const {
    error,
    isDocumentLoaded,
    PDFSlickViewer,
    viewerRef,
    usePDFSlickStore,
  } = usePDFSlick(url, {
    enableHWA: true,
    enableOptimizedPartialRendering: true,
    filename: file.name,
    minDurationToUpdateCanvas: 180,
    removePageBorders: true,
    scaleValue: "page-width",
    useOnlyCssZoom: true,
  });
  const numPages = usePDFSlickStore((state) => state.numPages);
  const pageNumber = usePDFSlickStore((state) => state.pageNumber);
  const pdfSlick = usePDFSlickStore((state) => state.pdfSlick);
  const scale = usePDFSlickStore((state) => state.scale);

  return (
    <div
      className="pdf-preview pdfSlick"
      onClick={(event) => event.stopPropagation()}
    >
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
