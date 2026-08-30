"use client";

import {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";

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
