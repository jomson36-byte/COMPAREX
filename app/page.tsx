"use client";

import {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type Slot = "left" | "right";

type UploadedFile = {
  file: File;
  url: string;
};

const acceptedExtensions = [".pdf", ".docx"];

function isAcceptedFile(file: File) {
  const name = file.name.toLowerCase();
  return acceptedExtensions.some((extension) => name.endsWith(extension));
}

function isPdfFile(file: File) {
  return file.name.toLowerCase().endsWith(".pdf");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function PdfPreview({ file }: { file: File }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState("Loading PDF...");
  const [error, setError] = useState("");

  useEffect(() => {
    let isCancelled = false;
    const renderTasks: Array<{
      cancel: () => void;
      promise: Promise<unknown>;
    }> = [];

    async function renderPdf() {
      try {
        const pagesElement = pagesRef.current;
        if (!pagesElement) return;

        pagesElement.replaceChildren();
        setStatus("Loading PDF...");
        setError("");
        setPageCount(0);

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();

        const data = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data }).promise;

        if (isCancelled) return;

        setPageCount(pdf.numPages);

        for (let currentPage = 1; currentPage <= pdf.numPages; currentPage += 1) {
          if (isCancelled) return;

          setStatus(`Rendering page ${currentPage} / ${pdf.numPages}`);

          const page = await pdf.getPage(currentPage);
          const viewport = page.getViewport({ scale: scale * 1.35 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            throw new Error("Canvas is not available");
          }

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.setAttribute("aria-label", `${file.name} page ${currentPage}`);
          pagesElement.appendChild(canvas);

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport,
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
        }

        if (!isCancelled) setStatus("");
      } catch (renderError) {
        if (!isCancelled) {
          const message =
            renderError instanceof Error
              ? renderError.message
              : "Unable to render PDF";
          setError(message);
          setStatus("");
        }
      }
    }

    renderPdf();

    return () => {
      isCancelled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  }, [file, scale]);

  return (
    <div className="pdf-preview" onClick={(event) => event.stopPropagation()}>
      <div className="preview-toolbar">
        <span>{pageCount ? `${pageCount} pages` : "Preparing"}</span>
        <button
          type="button"
          onClick={() => setScale((current) => Math.max(0.7, current - 0.1))}
          aria-label="Zoom out"
        >
          -
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => setScale((current) => Math.min(1.8, current + 0.1))}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>

      <div className="pdf-canvas-wrap">
        {status ? <p className="preview-status">{status}</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
        <div className="pdf-pages" ref={pagesRef} />
      </div>
    </div>
  );
}

function DropPanel({
  title,
  uploadedFile,
  onSelect,
  onClear,
}: {
  title: string;
  uploadedFile: UploadedFile | null;
  onSelect: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  const pickFile = (file: File | undefined) => {
    if (!file) return;

    if (!isAcceptedFile(file)) {
      setError("รองรับเฉพาะไฟล์ PDF และ DOCX เท่านั้น");
      return;
    }

    setError("");
    onSelect(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    pickFile(event.dataTransfer.files[0]);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    pickFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const clearFile = (event: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    setError("");
    onClear();
  };

  return (
    <section className="drop-panel" aria-label={title}>
      {uploadedFile ? (
        <button
          className="clear-file-button"
          type="button"
          onClick={clearFile}
          aria-label={`Remove ${title} file`}
          title="Remove file"
        >
          ×
        </button>
      ) : null}

      <div
        className={`drop-zone ${isDragging ? "dragging" : ""} ${
          uploadedFile ? "has-file" : ""
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onInputChange}
        />

        {uploadedFile ? (
          isPdfFile(uploadedFile.file) ? (
            <PdfPreview file={uploadedFile.file} />
          ) : (
            <div className="file-state">
              <div className="file-icon" aria-hidden="true">
                DOCX
              </div>
              <div className="file-details">
                <strong>{uploadedFile.file.name}</strong>
                <span>{formatFileSize(uploadedFile.file.size)}</span>
              </div>
              <span className="docx-note">
                DOCX preview จะต่อด้วย docx-preview ในเฟสถัดไป
              </span>
            </div>
          )
        ) : (
          <div className="empty-state">
            <div className="upload-mark" aria-hidden="true">
              +
            </div>
            <strong>Drag & Drop file here</strong>
            <span>หรือคลิกเพื่อเลือกไฟล์จากเครื่อง</span>
          </div>
        )}
      </div>

      {error ? <p className="error-message">{error}</p> : null}
    </section>
  );
}

export default function Home() {
  const [files, setFiles] = useState<Record<Slot, UploadedFile | null>>({
    left: null,
    right: null,
  });
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      Object.values(filesRef.current).forEach((item) => {
        if (item) URL.revokeObjectURL(item.url);
      });
    };
  }, []);

  const setFileForSlot = (slot: Slot, file: File) => {
    setFiles((current) => {
      if (current[slot]) URL.revokeObjectURL(current[slot].url);

      return {
        ...current,
        [slot]: {
          file,
          url: URL.createObjectURL(file),
        },
      };
    });
  };

  const clearFileForSlot = (slot: Slot) => {
    setFiles((current) => {
      if (current[slot]) URL.revokeObjectURL(current[slot].url);

      return {
        ...current,
        [slot]: null,
      };
    });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p>Document Review & Comparison</p>
          <h1>COMPARER</h1>
        </div>
        <div className="status-chip">Phase 1</div>
      </header>

      <section className="workspace" aria-label="Document upload workspace">
        <DropPanel
          title="Original Document"
          uploadedFile={files.left}
          onSelect={(file) => setFileForSlot("left", file)}
          onClear={() => clearFileForSlot("left")}
        />
        <DropPanel
          title="Compare With"
          uploadedFile={files.right}
          onSelect={(file) => setFileForSlot("right", file)}
          onClear={() => clearFileForSlot("right")}
        />
      </section>
    </main>
  );
}
