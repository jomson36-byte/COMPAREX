"use client";

import {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ArrowLeftRight, Columns2, ShieldCheck, Trash2 } from "lucide-react";
import comparexLogo from "./assets/png/comparex-horizontal-light-2x.png";

const PdfPreview = dynamic(() => import("./PdfPreview"), {
  ssr: false,
  loading: () => <p className="preview-status">Loading viewer...</p>,
});

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

function DropPanel({
  title,
  tone,
  uploadedFile,
  onSelect,
  onClear,
}: {
  title: string;
  tone: "version-a" | "version-b";
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
    <section className={`drop-panel ${tone}`} aria-label={title}>
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
            <PdfPreview
              key={uploadedFile.url}
              file={uploadedFile.file}
              url={uploadedFile.url}
            />
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
  const [leftWidth, setLeftWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const filesRef = useRef(files);
  const workspaceRef = useRef<HTMLElement>(null);

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

  const swapFiles = () => {
    setFiles((current) => ({
      left: current.right,
      right: current.left,
    }));
  };

  const clearSession = () => {
    if (!window.confirm("Remove both documents from this session?")) return;

    setFiles((current) => {
      Object.values(current).forEach((item) => {
        if (item) URL.revokeObjectURL(item.url);
      });

      return { left: null, right: null };
    });
  };

  const resizePanels = (event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;

    const workspace = workspaceRef.current;
    if (!workspace) return;

    const bounds = workspace.getBoundingClientRect();
    const nextWidth = ((event.clientX - bounds.left) / bounds.width) * 100;
    setLeftWidth(Math.min(80, Math.max(20, nextWidth)));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="toolbar-brand">
          <Image
            src={comparexLogo}
            alt="COMPAREX"
            width={158}
            priority
          />
        </div>

        <nav className="toolbar-actions" aria-label="Workspace tools">
          <button
            className="tool-button"
            type="button"
            onClick={swapFiles}
            disabled={!files.left && !files.right}
            aria-label="Swap Version A and Version B"
            title="Swap documents"
          >
            <ArrowLeftRight aria-hidden="true" size={17} />
            <span>Swap</span>
          </button>
          <button
            className="tool-button"
            type="button"
            onClick={() => setLeftWidth(50)}
            disabled={leftWidth === 50}
            aria-label="Make document panels equal width"
            title="Equal panes"
          >
            <Columns2 aria-hidden="true" size={17} />
            <span>Equal panes</span>
          </button>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            className="tool-button danger-tool"
            type="button"
            onClick={clearSession}
            disabled={!files.left && !files.right}
            aria-label="Remove both documents"
            title="Clear session"
          >
            <Trash2 aria-hidden="true" size={17} />
            <span>Clear</span>
          </button>
        </nav>

        <div
          className="privacy-status"
          title="Documents are processed in this browser"
        >
          <ShieldCheck aria-hidden="true" size={17} />
          <span>Local session</span>
        </div>
      </header>

      <section
        ref={workspaceRef}
        className={`workspace ${isResizing ? "resizing" : ""}`}
        aria-label="Document upload workspace"
        style={{ "--left-panel-width": `${leftWidth}%` } as React.CSSProperties}
      >
        <DropPanel
          title="Version A / Original"
          tone="version-a"
          uploadedFile={files.left}
          onSelect={(file) => setFileForSlot("left", file)}
          onClear={() => clearFileForSlot("left")}
        />
        <div
          className="panel-splitter"
          role="separator"
          aria-label="Resize document panels"
          aria-orientation="vertical"
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(leftWidth)}
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setIsResizing(true);
          }}
          onPointerMove={resizePanels}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            setIsResizing(false);
          }}
          onPointerCancel={() => setIsResizing(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const direction = event.key === "ArrowLeft" ? -2 : 2;
              setLeftWidth((current) =>
                Math.min(80, Math.max(20, current + direction)),
              );
            }
          }}
        >
          <span aria-hidden="true" />
        </div>
        <DropPanel
          title="Version B / Revised"
          tone="version-b"
          uploadedFile={files.right}
          onSelect={(file) => setFileForSlot("right", file)}
          onClear={() => clearFileForSlot("right")}
        />
      </section>
    </main>
  );
}
