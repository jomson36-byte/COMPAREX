"use client";

import {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Files as FilesIcon,
  GripVertical,
  Highlighter,
  Link2,
  Pin,
  PinOff,
  Plus,
  ShieldCheck,
  Trash2,
  Unlink2,
  X,
} from "lucide-react";
import comparexLogo from "./assets/png/comparex-horizontal-light-2x.png";
import { createAnnotatedPdf } from "./annotatedPdf.mts";
import type { PdfAnnotation } from "./annotatedPdf.mts";
import type { EvidenceMark } from "./PdfPreview";
import type { RequirementGridRow } from "./RequirementGrid";
import {
  appendRequirementPath,
  getParentRequirementNumber,
  getRootRequirementPath,
  normalizeRequirementStartPath,
  toAsciiDigits,
} from "./requirementNumbering.mts";

const PdfPreview = dynamic(() => import("./PdfPreview"), {
  ssr: false,
  loading: () => <p className="preview-status">Loading viewer...</p>,
});

const RequirementGrid = dynamic(() => import("./RequirementGrid"), {
  ssr: false,
  loading: () => <p className="review-empty">Loading requirements...</p>,
});

type Slot = "left" | "right";

type UploadedFile = {
  file: File;
  url: string;
};

type SelectedDocument = {
  file: File;
  handle?: FileSystemFileHandle;
};

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle[]>;
  }

  interface FileSystemFileHandle {
    queryPermission?: (descriptor?: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
    requestPermission?: (descriptor?: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
  }

  interface DataTransferItem {
    getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  }
}

type ReviewFilter = "all" | "unlinked" | "linked";

const acceptedExtensions = [".pdf", ".docx"];
const workspaceStorageKey = "comparex.workspace.v1";
const fileHandleDatabaseName = "comparex-file-handles";
const fileHandleStoreName = "handles";

type StoredFileHandle = {
  key: string;
  name: string;
  handle: FileSystemFileHandle;
};

type RestoreFilesResult = {
  attempted: number;
  restored: number;
};

type PrintableFileFailure = {
  fileName: string;
  reason: string;
};

type PersistedWorkspaceState = {
  version: 1;
  savedAt: string;
  workspaceName?: string;
  marks: EvidenceMark[];
  panel: {
    leftWidth: number;
    requirementStartNumber?: number;
    requirementStartPath?: string;
    isReviewOpen: boolean;
    isReviewPinned: boolean;
    showTorPane?: boolean;
    showEvidencePane?: boolean;
    reviewFilter: ReviewFilter;
    interactionMode: "highlight" | "link";
  };
  catalogLabelOffset: { x: number; y: number } | null;
  collapsedRequirementIds: string[];
  files: {
    torName: string | null;
    activeEvidenceName: string | null;
    evidenceNames: string[];
  };
};

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

function sanitizeMarksForStorage(marks: EvidenceMark[]) {
  return marks.map(({ fileUrl: _fileUrl, ...mark }) => mark);
}

function safeReviewFilter(value: unknown): ReviewFilter {
  return value === "linked" || value === "unlinked" ? value : "all";
}

function safeInteractionMode(value: unknown): "highlight" | "link" {
  return value === "link" ? "link" : "highlight";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Unknown PDF processing error";
}

function sanitizeWorkspaceName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function readPersistedWorkspace(): PersistedWorkspaceState | null {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
    if (parsed.version !== 1) return null;
    return parsed as PersistedWorkspaceState;
  } catch {
    return null;
  }
}

function writePersistedWorkspace(state: PersistedWorkspaceState) {
  try {
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private windows or full browser profiles.
  }
}

function clearPersistedWorkspace() {
  try {
    window.localStorage.removeItem(workspaceStorageKey);
    return true;
  } catch {
    return false;
  }
}

function openFileHandleDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(fileHandleDatabaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(fileHandleStoreName, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withFileHandleStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openFileHandleDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(fileHandleStoreName, mode);
    const request = callback(transaction.objectStore(fileHandleStoreName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function saveFileHandle(key: string, name: string, handle?: FileSystemFileHandle) {
  if (!handle || !("indexedDB" in window)) return;
  try {
    await withFileHandleStore("readwrite", (store) =>
      store.put({ key, name, handle } satisfies StoredFileHandle),
    );
  } catch {
    // File handles are a convenience layer; metadata autosave still works.
  }
}

async function readFileHandle(key: string) {
  if (!("indexedDB" in window)) return null;
  try {
    const record = await withFileHandleStore<StoredFileHandle | undefined>(
      "readonly",
      (store) => store.get(key),
    );
    return record ?? null;
  } catch {
    return null;
  }
}

async function deleteFileHandle(key: string) {
  if (!("indexedDB" in window)) return;
  try {
    await withFileHandleStore("readwrite", (store) => store.delete(key));
  } catch {
    // Ignore stale handles.
  }
}

async function clearFileHandles() {
  if (!("indexedDB" in window)) return true;
  try {
    const database = await openFileHandleDatabase();
    return await new Promise<boolean>((resolve) => {
      const transaction = database.transaction(fileHandleStoreName, "readwrite");
      transaction.objectStore(fileHandleStoreName).clear();
      transaction.oncomplete = () => {
        database.close();
        resolve(true);
      };
      const fail = () => {
        database.close();
        resolve(false);
      };
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  } catch {
    return false;
  }
}

async function getReadableFileFromHandle(record: StoredFileHandle) {
  try {
    const permission = record.handle.queryPermission
      ? await record.handle.queryPermission({ mode: "read" })
      : "granted";
    const grantedPermission =
      permission === "granted" ||
      (record.handle.requestPermission
        ? (await record.handle.requestPermission({ mode: "read" })) === "granted"
        : false);
    if (!grantedPermission) return null;

    const file = await record.handle.getFile();
    return isAcceptedFile(file) ? file : null;
  } catch {
    return null;
  }
}

async function getDroppedDocuments(event: DragEvent<HTMLDivElement>) {
  const items = Array.from(event.dataTransfer.items);
  const handleDocuments = await Promise.all<SelectedDocument | null>(
    items.map(async (item) => {
      const getHandle = item.getAsFileSystemHandle;
      if (!getHandle) return null;
      const handle = await getHandle.call(item);
      if (handle?.kind !== "file") return null;
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      return { file, handle: fileHandle };
    }),
  );
  const documents = handleDocuments.filter(
    (item): item is SelectedDocument => Boolean(item),
  );
  if (documents.length) return documents;
  return Array.from(event.dataTransfer.files).map((file) => ({ file }));
}

function DropPanel({
  id,
  title,
  tone,
  uploadedFile,
  multiple = false,
  onSelect,
  onClear,
  toolbar,
  previewProps,
}: {
  id?: string;
  title: string;
  tone: "version-a" | "version-b";
  uploadedFile: UploadedFile | null;
  multiple?: boolean;
  onSelect: (documents: SelectedDocument[]) => void;
  onClear?: () => void;
  toolbar?: ReactNode;
  previewProps?: {
    side: "tor" | "catalog";
    pendingLinkId: string | null;
    interactionMode: "highlight" | "link";
    marks: EvidenceMark[];
    requirementNumberByLinkId?: ReadonlyMap<string, string>;
    onCreateMark: (mark: EvidenceMark, intent: "highlight" | "link") => void;
    onMoveMark?: (
      id: string,
      position: { x: number; y: number },
      offset: { x: number; y: number },
    ) => void;
  };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  const pickDocuments = (selectedDocuments: SelectedDocument[]) => {
    const candidates = multiple
      ? selectedDocuments
      : selectedDocuments.slice(0, 1);
    const accepted = candidates.filter(({ file }) => isAcceptedFile(file));
    const rejected = candidates.length - accepted.length;

    setError(
      rejected
        ? `ไม่เพิ่ม ${rejected} ไฟล์: รองรับเฉพาะ PDF และ DOCX`
        : "",
    );
    if (accepted.length) onSelect(accepted);
  };

  const openPicker = async () => {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const handles = await window.showOpenFilePicker({
          multiple,
          types: [
            {
              description: "PDF and Word documents",
              accept: {
                "application/pdf": [".pdf"],
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
                  ".docx",
                ],
              },
            },
          ],
        });
        const documents = await Promise.all(
          handles.map(async (handle) => ({
            file: await handle.getFile(),
            handle,
          })),
        );
        pickDocuments(documents);
        return;
      } catch (pickerError) {
        if (
          pickerError instanceof DOMException &&
          pickerError.name === "AbortError"
        ) {
          return;
        }
      }
    }

    inputRef.current?.click();
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    pickDocuments(await getDroppedDocuments(event));
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    pickDocuments(
      Array.from(event.target.files ?? []).map((file) => ({ file })),
    );
    event.target.value = "";
  };

  const clearFile = (event: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    setError("");
    onClear?.();
  };

  return (
    <section
      id={id}
      className={`drop-panel ${tone} ${toolbar ? "has-panel-toolbar" : ""}`}
      aria-label={title}
    >
      {toolbar}
      {uploadedFile && onClear ? (
        <button
          className="clear-file-button"
          type="button"
          onClick={clearFile}
          aria-label={`Remove ${title} file`}
          title="Remove file"
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      ) : null}

      <div
        className={`drop-zone ${isDragging ? "dragging" : ""} ${
          uploadedFile ? "has-file" : ""
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onClick={() => void openPicker()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void openPicker();
          }
        }}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple={multiple}
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onInputChange}
        />

        {uploadedFile ? (
          isPdfFile(uploadedFile.file) ? (
            <PdfPreview
              key={uploadedFile.url}
              file={uploadedFile.file}
              url={uploadedFile.url}
              sourceUrl={uploadedFile.url}
              side={previewProps?.side ?? "tor"}
              pendingLinkId={previewProps?.pendingLinkId ?? null}
              interactionMode={previewProps?.interactionMode ?? "highlight"}
              marks={previewProps?.marks ?? []}
              requirementNumberByLinkId={previewProps?.requirementNumberByLinkId}
              onCreateMark={previewProps?.onCreateMark ?? (() => undefined)}
              onMoveMark={previewProps?.onMoveMark}
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

function ReviewMarkItem({
  mark,
  isPaired,
  pendingLinkId,
  onLink,
  onUnlink,
  onRemove,
  onJump,
  draggable = false,
  onDragStart,
}: {
  mark: EvidenceMark;
  isPaired: boolean;
  pendingLinkId: string | null;
  onLink: (mark: EvidenceMark) => void;
  onUnlink: (mark: EvidenceMark) => void;
  onRemove: (mark: EvidenceMark) => void;
  onJump: (mark: EvidenceMark) => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>, mark: EvidenceMark) => void;
}) {
  const canUnlink = isPaired && mark.side === "catalog";

  return (
    <div
      className={`review-mark ${mark.side} ${draggable ? "draggable" : ""}`}
      draggable={draggable}
      onDragStart={(event) => onDragStart?.(event, mark)}
    >
      <button
        className="review-mark-main"
        type="button"
        onClick={() => onJump(mark)}
      >
        <span className="review-mark-meta">
          {draggable ? <GripVertical aria-hidden="true" size={13} /> : null}
          {mark.manual
            ? "Manual requirement"
            : `${mark.side === "tor" ? "TOR" : "Evidence"} · Page ${mark.page}`}
          {isPaired ? <Link2 aria-label="Linked" size={13} /> : null}
        </span>
        <strong>{mark.text}</strong>
        {!mark.manual ? <small>{mark.fileName}</small> : null}
        {mark.note ? <em>{mark.note}</em> : null}
      </button>
      <div className="review-mark-actions">
        <button
          className={`review-mark-link ${canUnlink ? "unlink" : ""}`}
          type="button"
          onClick={() => canUnlink ? onUnlink(mark) : onLink(mark)}
          disabled={mark.side === "catalog" && !isPaired && !pendingLinkId}
          aria-label={
            canUnlink
              ? `Unlink evidence highlight on page ${mark.page}`
              : mark.side === "tor"
                ? `Add evidence to TOR highlight on page ${mark.page}`
                : `Link evidence highlight on page ${mark.page}`
          }
          title={
            canUnlink
              ? "Unlink evidence"
              : mark.side === "tor"
                ? isPaired ? "Add supporting evidence" : "Link evidence"
                : "Link to selected TOR"
          }
        >
          {canUnlink ? (
            <Unlink2 aria-hidden="true" size={15} />
          ) : (
            <Link2 aria-hidden="true" size={15} />
          )}
        </button>
        <button
          className="review-mark-remove"
          type="button"
          onClick={() => onRemove(mark)}
          aria-label={`Remove highlight on page ${mark.page}`}
          title="Remove highlight"
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [files, setFiles] = useState<Record<Slot, UploadedFile | null>>({
    left: null,
    right: null,
  });
  const [workspaceName, setWorkspaceName] = useState("Untitled workspace");
  const [leftWidth, setLeftWidth] = useState(50);
  const [requirementStartPath, setRequirementStartPath] = useState("1");
  const [isResizing, setIsResizing] = useState(false);
  const [catalogFiles, setCatalogFiles] = useState<UploadedFile[]>([]);
  const [isCatalogMenuOpen, setIsCatalogMenuOpen] = useState(false);
  const [isDownloadingEvidence, setIsDownloadingEvidence] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearingProject, setIsClearingProject] = useState(false);
  const [marks, setMarks] = useState<EvidenceMark[]>([]);
  const [catalogLabelOffset, setCatalogLabelOffset] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pendingLinkId, setPendingLinkId] = useState<string | null>(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isReviewPinned, setIsReviewPinned] = useState(false);
  const [showTorPane, setShowTorPane] = useState(true);
  const [showEvidencePane, setShowEvidencePane] = useState(true);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [dragOverTorId, setDragOverTorId] = useState<string | null>(null);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<"highlight" | "link">("highlight");
  const [collapsedRequirements, setCollapsedRequirements] = useState<Set<string>>(
    new Set(),
  );
  const [requirementComposer, setRequirementComposer] = useState<{
    parentId: string | null;
    value: string;
  } | null>(null);
  const [storedFileHint, setStoredFileHint] =
    useState<PersistedWorkspaceState["files"] | null>(null);
  const [hasRestoredWorkspace, setHasRestoredWorkspace] = useState(false);
  const [isRestoringFiles, setIsRestoringFiles] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  const sessionFilesRef = useRef<{
    tor: UploadedFile | null;
    catalogs: UploadedFile[];
  }>({ tor: null, catalogs: [] });
  const workspaceRef = useRef<HTMLElement>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const skipNextPersistRef = useRef(false);
  const catalogMenuRef = useRef<HTMLDetailsElement>(null);
  const catalogPickerRef = useRef<HTMLInputElement>(null);

  const restoreFilesFromHandles = async (
    fileHint: PersistedWorkspaceState["files"] | null,
  ): Promise<RestoreFilesResult> => {
    if (!fileHint) return { attempted: 0, restored: 0 };

    const torHandle = await readFileHandle("tor");
    const torFile = torHandle
      ? await getReadableFileFromHandle(torHandle)
      : null;
    const restoredCatalogs = await Promise.all(
      (fileHint.evidenceNames ?? []).map(async (name) => {
        const record = await readFileHandle(`catalog:${name}`);
        const file = record ? await getReadableFileFromHandle(record) : null;
        return file ? { file, url: URL.createObjectURL(file) } : null;
      }),
    );
    const catalogs = restoredCatalogs.filter(
      (item): item is UploadedFile => Boolean(item),
    );

    if (torFile) {
      const url = URL.createObjectURL(torFile);
      setFiles((current) => ({
        ...current,
        left: { file: torFile, url },
      }));
      setMarks((current) =>
        current.map((mark) =>
          mark.side === "tor" && mark.fileName === torFile.name
            ? { ...mark, fileUrl: url }
            : mark,
        ),
      );
    }

    if (catalogs.length) {
      const active =
        catalogs.find((item) => item.file.name === fileHint.activeEvidenceName) ??
        catalogs[0];
      setCatalogFiles(catalogs);
      setFiles((current) => ({
        ...current,
        right: active,
      }));
      setMarks((current) =>
        current.map((mark) => {
          if (mark.side !== "catalog") return mark;
          const match = catalogs.find((item) => item.file.name === mark.fileName);
          return match ? { ...mark, fileUrl: match.url } : mark;
        }),
      );
    }

    if (torFile || catalogs.length) {
      setStoredFileHint((current) => ({
        torName: torFile?.name ?? current?.torName ?? fileHint.torName,
        activeEvidenceName:
          catalogs.find((item) => item.file.name === fileHint.activeEvidenceName)
            ?.file.name ??
          current?.activeEvidenceName ??
          fileHint.activeEvidenceName,
        evidenceNames: Array.from(
          new Set([
            ...(current?.evidenceNames ?? fileHint.evidenceNames),
            ...catalogs.map((item) => item.file.name),
          ]),
        ),
      }));
    }

    return {
      attempted: Number(Boolean(fileHint.torName)) + (fileHint.evidenceNames ?? []).length,
      restored: Number(Boolean(torFile)) + catalogs.length,
    };
  };

  const handleRestoreFiles = async () => {
    setIsRestoringFiles(true);
    setRestoreMessage("Restoring file access...");
    try {
      const result = await restoreFilesFromHandles(storedFileHint);
      if (!result.attempted) {
        setRestoreMessage("No saved file references to restore.");
      } else if (result.restored) {
        setRestoreMessage(
          `Restored ${result.restored} of ${result.attempted} saved file${result.attempted === 1 ? "" : "s"}.`,
        );
      } else {
        setRestoreMessage(
          "Could not restore files automatically. Use Add documents and choose the same files again to refresh permission.",
        );
      }
    } finally {
      setIsRestoringFiles(false);
    }
  };

  const openCatalogPicker = async () => {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: "PDF and Word documents",
              accept: {
                "application/pdf": [".pdf"],
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
                  ".docx",
                ],
              },
            },
          ],
        });
        const documents = await Promise.all(
          handles.map(async (handle) => ({
            file: await handle.getFile(),
            handle,
          })),
        );
        addCatalogFiles(documents.filter(({ file }) => isAcceptedFile(file)));
        return;
      } catch (pickerError) {
        if (
          pickerError instanceof DOMException &&
          pickerError.name === "AbortError"
        ) {
          return;
        }
      }
    }

    catalogPickerRef.current?.click();
  };

  useEffect(() => {
    const restoreWorkspace = async () => {
      const restored = readPersistedWorkspace();
      if (!restored) {
        setHasRestoredWorkspace(true);
        return;
      }

      setWorkspaceName(
        sanitizeWorkspaceName(restored.workspaceName ?? "") ||
          "Untitled workspace",
      );
      setMarks(sanitizeMarksForStorage(restored.marks ?? []));
      setLeftWidth(
        Math.min(80, Math.max(20, Number(restored.panel?.leftWidth) || 50)),
      );
      setRequirementStartPath(
        normalizeRequirementStartPath(
          restored.panel?.requirementStartPath ??
            restored.panel?.requirementStartNumber,
        ),
      );
      setIsReviewOpen(Boolean(restored.panel?.isReviewOpen));
      setIsReviewPinned(Boolean(restored.panel?.isReviewPinned));
      setShowTorPane(restored.panel?.showTorPane ?? true);
      setShowEvidencePane(restored.panel?.showEvidencePane ?? true);
      setReviewFilter(safeReviewFilter(restored.panel?.reviewFilter));
      setInteractionMode(safeInteractionMode(restored.panel?.interactionMode));
      setCatalogLabelOffset(restored.catalogLabelOffset ?? null);
      setCollapsedRequirements(
        new Set(
          Array.isArray(restored.collapsedRequirementIds)
            ? restored.collapsedRequirementIds
            : [],
        ),
      );
      setStoredFileHint(restored.files);
      await restoreFilesFromHandles(restored.files);

      setHasRestoredWorkspace(true);
    };

    void restoreWorkspace();
  }, []);

  useEffect(() => {
    if (!hasRestoredWorkspace) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    writePersistedWorkspace({
      version: 1,
      savedAt: new Date().toISOString(),
      workspaceName: sanitizeWorkspaceName(workspaceName),
      marks: sanitizeMarksForStorage(marks),
      panel: {
        leftWidth,
        requirementStartPath,
        isReviewOpen,
        isReviewPinned,
        showTorPane,
        showEvidencePane,
        reviewFilter,
        interactionMode,
      },
      catalogLabelOffset,
      collapsedRequirementIds: Array.from(collapsedRequirements),
      files: {
        torName: files.left?.file.name ?? storedFileHint?.torName ?? null,
        activeEvidenceName:
          files.right?.file.name ?? storedFileHint?.activeEvidenceName ?? null,
        evidenceNames: Array.from(
          new Set([
            ...(storedFileHint?.evidenceNames ?? []),
            ...catalogFiles.map((item) => item.file.name),
            ...marks
              .filter((mark) => mark.side === "catalog")
              .map((mark) => mark.fileName),
          ]),
        ),
      },
    });
  }, [
    catalogFiles,
    catalogLabelOffset,
    collapsedRequirements,
    files.left,
    files.right,
    hasRestoredWorkspace,
    interactionMode,
    isReviewOpen,
    isReviewPinned,
    showTorPane,
    showEvidencePane,
    leftWidth,
    marks,
    requirementStartPath,
    reviewFilter,
    storedFileHint,
    workspaceName,
  ]);

  useEffect(() => {
    const dialog = clearDialogRef.current;
    if (!dialog) return;
    if (isClearConfirmOpen && !dialog.open) dialog.showModal();
    if (!isClearConfirmOpen && dialog.open) dialog.close();
  }, [isClearConfirmOpen]);

  useEffect(() => {
    sessionFilesRef.current = { tor: files.left, catalogs: catalogFiles };
  }, [files.left, catalogFiles]);

  useEffect(() => {
    return () => {
      const { tor, catalogs } = sessionFilesRef.current;
      if (tor) URL.revokeObjectURL(tor.url);
      catalogs.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  useEffect(() => {
    if (!isCatalogMenuOpen) return;

    const closeMenu = (event: globalThis.PointerEvent) => {
      if (!catalogMenuRef.current?.contains(event.target as Node)) {
        setIsCatalogMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCatalogMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isCatalogMenuOpen]);

  useEffect(() => {
    if (!pendingJumpId) return;

    const jumpWhenReady = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== pendingJumpId) return;
      window.dispatchEvent(
        new CustomEvent("comparex:jump-to-mark", { detail: pendingJumpId }),
      );
      setPendingJumpId(null);
    };
    window.addEventListener("comparex:mark-ready", jumpWhenReady);
    return () => window.removeEventListener("comparex:mark-ready", jumpWhenReady);
  }, [pendingJumpId]);

  const setFileForSlot = (slot: Slot, document: SelectedDocument) => {
    const { file, handle } = document;
    const url = URL.createObjectURL(file);
    setFiles((current) => {
      if (current[slot]) URL.revokeObjectURL(current[slot].url);

      return {
        ...current,
        [slot]: {
          file,
          url,
        },
      };
    });
    setMarks((current) =>
      current.map((mark) =>
        mark.side === (slot === "left" ? "tor" : "catalog") &&
        mark.fileName === file.name
          ? { ...mark, fileUrl: url }
          : mark,
      ),
    );
    void saveFileHandle(slot === "left" ? "tor" : `catalog:${file.name}`, file.name, handle);
    setStoredFileHint((current) => ({
      torName: slot === "left" ? file.name : (current?.torName ?? null),
      activeEvidenceName:
        slot === "right" ? file.name : (current?.activeEvidenceName ?? null),
      evidenceNames:
        slot === "right"
          ? Array.from(new Set([...(current?.evidenceNames ?? []), file.name]))
          : (current?.evidenceNames ?? []),
    }));
  };

  const clearFileForSlot = (slot: Slot) => {
    const currentRightName = files.right?.file.name;
    setFiles((current) => {
      if (current[slot]) URL.revokeObjectURL(current[slot].url);

      return {
        ...current,
        [slot]: null,
      };
    });
    setStoredFileHint((current) =>
      current
        ? {
            torName: slot === "left" ? null : current.torName,
            activeEvidenceName:
              slot === "right" && current.activeEvidenceName === currentRightName
                ? null
                : current.activeEvidenceName,
            evidenceNames:
              slot === "right" && currentRightName
                ? current.evidenceNames.filter((name) => name !== currentRightName)
                : current.evidenceNames,
          }
        : current,
    );
    void deleteFileHandle(slot === "left" ? "tor" : `catalog:${currentRightName ?? ""}`);
  };

  const addCatalogFiles = (selectedDocuments: SelectedDocument[]) => {
    const additions = selectedDocuments.map(({ file }) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    if (!additions.length) return;

    setCatalogFiles((current) => [...current, ...additions]);
    setFiles((current) => ({
      ...current,
      right: additions[0],
    }));
    setMarks((current) =>
      current.map((mark) => {
        if (mark.side !== "catalog") return mark;
        const matchingFile = additions.find(
          (item) => item.file.name === mark.fileName,
        );
        return matchingFile ? { ...mark, fileUrl: matchingFile.url } : mark;
      }),
    );
    selectedDocuments.forEach(({ file, handle }) => {
      void saveFileHandle(`catalog:${file.name}`, file.name, handle);
    });
    setStoredFileHint((current) => ({
      torName: current?.torName ?? null,
      activeEvidenceName: additions[0].file.name,
      evidenceNames: Array.from(
        new Set([
          ...(current?.evidenceNames ?? []),
          ...additions.map((item) => item.file.name),
        ]),
      ),
    }));
  };

  const removeCatalogFile = (item: UploadedFile) => {
    if (!window.confirm(`Remove “${item.file.name}” from Product Evidence?`)) {
      return;
    }

    const index = catalogFiles.findIndex((catalog) => catalog.url === item.url);
    const nextCatalogs = catalogFiles.filter(
      (catalog) => catalog.url !== item.url,
    );
    setCatalogFiles(nextCatalogs);
    setFiles((current) => ({
      ...current,
      right:
        current.right?.url === item.url
          ? (nextCatalogs[Math.min(index, nextCatalogs.length - 1)] ?? null)
          : current.right,
    }));
    URL.revokeObjectURL(item.url);
    void deleteFileHandle(`catalog:${item.file.name}`);
    setStoredFileHint((current) =>
      current
        ? {
            ...current,
            activeEvidenceName:
              current.activeEvidenceName === item.file.name
                ? (nextCatalogs[0]?.file.name ?? null)
                : current.activeEvidenceName,
            evidenceNames: current.evidenceNames.filter(
              (name) => name !== item.file.name,
            ),
          }
        : current,
    );
  };

  const createEvidenceMark = (
    mark: EvidenceMark,
    intent: "highlight" | "link",
  ) => {
    const markWithLabelDefault =
      mark.side === "catalog" && catalogLabelOffset
        ? { ...mark, labelOffset: catalogLabelOffset }
        : mark;
    if (intent === "link" && mark.side === "tor") {
      if (mark.linkId) {
        // A manually created requirement already owns this link. Keep the
        // later TOR selection as its source reference, not a new requirement.
        setMarks((current) => [
          ...current,
          { ...markWithLabelDefault, referenceOnly: true },
        ]);
        return;
      }
      const linkId = crypto.randomUUID();
      setMarks((current) => [...current, { ...markWithLabelDefault, linkId }]);
      setPendingLinkId(linkId);
      setInteractionMode("link");
      return;
    }

    setMarks((current) => [...current, markWithLabelDefault]);
    if (intent === "link" && mark.side === "catalog" && pendingLinkId) {
      setPendingLinkId(null);
    }
  };

  const removeEvidenceMark = (mark: EvidenceMark) => {
    setMarks((current) =>
      current
        .filter((item) => item.id !== mark.id)
        .map((item) =>
          item.parentId === mark.id ? { ...item, parentId: undefined } : item,
        ),
    );
    if (pendingLinkId && mark.linkId === pendingLinkId) {
      setPendingLinkId(null);
    }
    window.dispatchEvent(
      new CustomEvent("comparex:remove-mark", { detail: mark.id }),
    );
  };

  const removeRequirements = (requirements: EvidenceMark[]) => {
    const ids = new Set(requirements.map((item) => item.id));
    const label = requirements.length === 1 ? "requirement" : "requirements";
    if (
      !window.confirm(
        `Remove ${requirements.length} selected ${label}? Supporting evidence will remain unassigned.`,
      )
    ) {
      return;
    }
    setMarks((current) =>
      current
        .filter((item) => !ids.has(item.id))
        .map((item) =>
          item.parentId && ids.has(item.parentId)
            ? { ...item, parentId: undefined }
            : item,
        ),
    );
    requirements.forEach((item) => {
      window.dispatchEvent(
        new CustomEvent("comparex:remove-mark", { detail: item.id }),
      );
    });
    if (requirements.some((item) => item.linkId === pendingLinkId)) {
      setPendingLinkId(null);
    }
  };

  const createManualRequirement = (title: string, parentId?: string) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;

    const id = crypto.randomUUID();
    setMarks((current) => [
      ...current,
      {
        id,
        side: "tor",
        fileName: "Manual requirement",
        page: 0,
        text: normalizedTitle,
        manual: true,
        parentId,
      },
    ]);
    if (parentId) {
      setCollapsedRequirements((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
  };

  const createManualRequirements = (
    items: Array<{ number: string; title: string }>,
  ) => {
    const idsByNumber = new Map<string, string>();
    const additions = items.map((item) => {
      const id = crypto.randomUUID();
      idsByNumber.set(toAsciiDigits(item.number), id);
      return { ...item, id };
    });
    setMarks((current) => [
      ...current,
      ...additions.map((item) => {
        const parentNumber = getParentRequirementNumber(item.number);
        return {
          id: item.id,
          side: "tor" as const,
          fileName: "Manual requirement",
          page: 0,
          text: item.title,
          manual: true,
          requirementNo: item.number,
          parentId: parentNumber ? idsByNumber.get(parentNumber) : undefined,
        };
      }),
    ]);
  };

  const renameRequirement = (mark: EvidenceMark, title: string) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    setMarks((current) =>
      current.map((item) =>
        item.id === mark.id ? { ...item, text: normalizedTitle } : item,
      ),
    );
  };

  const renameRequirementNo = (mark: EvidenceMark, requirementNo: string) => {
    const normalizedNumber = requirementNo.trim();
    const isStructuralNumber = /^\d+(?:\.\d+)*$/.test(normalizedNumber);
    if (!isStructuralNumber) {
      setMarks((current) =>
        current.map((item) =>
          item.id === mark.id
            ? { ...item, requirementNo: normalizedNumber }
            : item,
        ),
      );
      return;
    }

    const numberParts = normalizedNumber.split(".").map(Number);
    if (numberParts.some((part) => part < 1)) return;

    const roots = torMarks.filter(
      (item) =>
        !item.parentId ||
        !torMarks.some((candidate) => candidate.id === item.parentId),
    );
    const flattenCurrentNumbers = (
      items: EvidenceMark[],
      prefix = "",
    ): Array<{ mark: EvidenceMark; path: string }> =>
      items.flatMap((item, index) => {
        const fallbackPath = prefix
          ? `${prefix}.${index + 1}`
          : getRootRequirementPath(requirementStartPath, index);
        const path = item.requirementNo?.trim() || fallbackPath;
        const children = torMarks.filter((child) => child.parentId === item.id);
        return [
          { mark: item, path },
          ...flattenCurrentNumbers(children, path),
        ];
      });
    const flattened = flattenCurrentNumbers(roots);
    const currentItem = flattened.find((item) => item.mark.id === mark.id);
    const currentNumber =
      currentItem?.path || mark.requirementNo?.trim() || normalizedNumber;
    const descendants = flattened.filter(
      (item) =>
        item.mark.id !== mark.id && item.path.startsWith(`${currentNumber}.`),
    );
    const shouldUpdateHierarchy =
      descendants.length > 0 &&
      window.confirm(
        `Change this requirement and ${descendants.length} sub-requirement${descendants.length === 1 ? "" : "s"} from ${currentNumber} to ${normalizedNumber}?`,
      );
    const nextNumberById = new Map(
      shouldUpdateHierarchy
        ? descendants.map((item) => [
            item.mark.id,
            `${normalizedNumber}${item.path.slice(currentNumber.length)}`,
          ])
        : [],
    );

    setMarks((current) => {
      if (!shouldUpdateHierarchy) {
        return current.map((item) =>
          item.id === mark.id
            ? { ...item, requirementNo: normalizedNumber }
            : item,
        );
      }

      return current.map((item) =>
        item.id === mark.id
          ? { ...item, requirementNo: normalizedNumber }
          : nextNumberById.has(item.id)
            ? { ...item, requirementNo: nextNumberById.get(item.id) }
            : item,
      );
    });
  };

  const changeRequirementParent = (mark: EvidenceMark, parentId?: string) => {
    if (parentId === mark.id) return;
    const byId = new Map(torMarks.map((item) => [item.id, item]));
    let ancestorId = parentId;
    while (ancestorId) {
      if (ancestorId === mark.id) return;
      ancestorId = byId.get(ancestorId)?.parentId;
    }
    setMarks((current) =>
      current.map((item) =>
        // A hierarchy change makes the structural number authoritative again.
        item.id === mark.id
          ? { ...item, parentId, requirementNo: undefined }
          : item,
      ),
    );
  };

  const addManualRequirement = () => {
    const title = requirementComposer?.value.trim();
    if (!title) return;
    createManualRequirement(title, requirementComposer?.parentId ?? undefined);
    setRequirementComposer(null);
  };

  const toggleRequirement = (id: string) => {
    setCollapsedRequirements((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const linkExistingMark = (mark: EvidenceMark) => {
    if (mark.side === "tor") {
      const linkId = mark.linkId ?? crypto.randomUUID();
      setMarks((current) =>
        current.map((item) =>
          item.id === mark.id ? { ...item, linkId } : item,
        ),
      );
      setPendingLinkId(linkId);
      setInteractionMode("link");
      return;
    }

    if (!pendingLinkId) return;
    setMarks((current) =>
      current.map((item) =>
        item.id === mark.id ? { ...item, linkId: pendingLinkId } : item,
      ),
    );
    setPendingLinkId(null);
  };

  const unlinkEvidenceMark = (mark: EvidenceMark) => {
    if (!mark.linkId) return;
    const linkId = mark.linkId;
    setMarks((current) => {
      if (mark.side === "tor") {
        return current.map((item) =>
          item.linkId === linkId ? { ...item, linkId: undefined } : item,
        );
      }

      const remainingEvidence = current.filter(
        (item) =>
          item.side === "catalog" &&
          item.id !== mark.id &&
          item.linkId === linkId,
      );
      return current.map((item) => {
        if (item.id === mark.id) return { ...item, linkId: undefined };
        if (!remainingEvidence.length && item.side === "tor" && item.linkId === linkId) {
          return { ...item, linkId: undefined };
        }
        return item;
      });
    });
    if (pendingLinkId === linkId) setPendingLinkId(null);
  };

  const linkDroppedEvidence = (torMark: EvidenceMark, evidenceId: string) => {
    const evidenceMark = marks.find(
      (mark) => mark.id === evidenceId && mark.side === "catalog",
    );
    if (!evidenceMark) return;

    const linkId = torMark.linkId ?? crypto.randomUUID();
    setMarks((current) =>
      current.map((mark) => {
        if (mark.id === torMark.id || mark.id === evidenceMark.id) {
          return { ...mark, linkId };
        }
        return mark;
      }),
    );
    setPendingLinkId(null);
    setDragOverTorId(null);
  };

  const startEvidenceDrag = (
    event: DragEvent<HTMLElement>,
    mark: EvidenceMark,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-comparex-evidence", mark.id);
    event.dataTransfer.setData("text/plain", mark.text);
  };

  const jumpToEvidenceMark = (mark: EvidenceMark) => {
    if (mark.manual) return;
    if (mark.side === "tor") {
      window.dispatchEvent(
        new CustomEvent("comparex:jump-to-mark", { detail: mark.id }),
      );
      return;
    }

    const targetFile = catalogFiles.find(
      (item) =>
        (mark.fileUrl && item.url === mark.fileUrl) ||
        item.file.name === mark.fileName,
    );
    if (!targetFile || files.right?.url === targetFile.url) {
      window.dispatchEvent(
        new CustomEvent("comparex:jump-to-mark", { detail: mark.id }),
      );
      return;
    }

    setPendingJumpId(mark.id);
    setFiles((current) => ({ ...current, right: targetFile }));
  };

  const linkGroups = marks.reduce((groups, mark) => {
      if (!mark.linkId) return groups;
      groups.set(mark.linkId, (groups.get(mark.linkId) ?? 0) + 1);
      return groups;
    }, new Map<string, number>());
  const pairedLinkIds = new Set(
    Array.from(linkGroups).filter(([, count]) => count > 1).map(([id]) => id),
  );
  const catalogMarks = marks.filter((mark) => mark.side === "catalog");
  const highlightCount = catalogMarks.length;
  const linkedCount = catalogMarks.filter(
    (mark) =>
      Boolean(mark.linkId && pairedLinkIds.has(mark.linkId)),
  ).length;
  const torMarks = marks.filter(
    (mark) => mark.side === "tor" && !mark.referenceOnly,
  );
  const unlinkedCatalogMarks = catalogMarks.filter(
    (mark) => !mark.linkId || !pairedLinkIds.has(mark.linkId),
  );
  const unlinkedCount = unlinkedCatalogMarks.length;
  const visibleTorMarks = torMarks.filter((mark) => {
    const isPaired = Boolean(mark.linkId && pairedLinkIds.has(mark.linkId));
    if (reviewFilter === "linked") return isPaired;
    if (reviewFilter === "unlinked") return !isPaired;
    return true;
  });
  const visibleTorIds = new Set(visibleTorMarks.map((mark) => mark.id));
  const rootRequirements = torMarks.filter(
    (mark) => !mark.parentId || !torMarks.some((item) => item.id === mark.parentId),
  );
  const flattenRequirements = (
    items: EvidenceMark[],
    prefix = "",
    depth = 0,
  ): Array<{ mark: EvidenceMark; path: string; depth: number }> =>
    items.flatMap((mark, index) => {
      const path = prefix
        ? appendRequirementPath(prefix, index + 1)
        : getRootRequirementPath(requirementStartPath, index);
      const children = torMarks.filter((item) => item.parentId === mark.id);
      return [
        { mark, path, depth },
        ...flattenRequirements(children, path, depth + 1),
      ];
    });
  const allRequirementRows = flattenRequirements(rootRequirements);
  const requirementRows = allRequirementRows.filter(({ mark }) =>
    visibleTorIds.has(mark.id),
  );
  const requirementRowById = new Map(
    allRequirementRows.map((row) => [row.mark.id, row]),
  );
  const getRootRequirementRow = (mark: EvidenceMark) => {
    let currentRow = requirementRowById.get(mark.id);
    const visitedIds = new Set<string>();

    while (
      currentRow?.mark.parentId &&
      !visitedIds.has(currentRow.mark.parentId)
    ) {
      visitedIds.add(currentRow.mark.id);
      const parentRow = requirementRowById.get(currentRow.mark.parentId);
      if (!parentRow) break;
      currentRow = parentRow;
    }

    return currentRow;
  };
  const requirementNumberByLinkId = new Map<string, string>();
  const rootRequirementDetailsByLinkId = new Map<
    string,
    { requirementNo: string; text: string }
  >();
  for (const { mark, path } of allRequirementRows) {
    if (!mark.linkId) continue;
    const requirementNo = mark.requirementNo?.trim() || path;
    const rootRequirement = getRootRequirementRow(mark);
    const rootRequirementNo =
      rootRequirement?.mark.requirementNo?.trim() || rootRequirement?.path;

    requirementNumberByLinkId.set(mark.linkId, requirementNo);
    if (rootRequirementNo && rootRequirement) {
      rootRequirementDetailsByLinkId.set(mark.linkId, {
        requirementNo: rootRequirementNo,
        text: rootRequirement.mark.text.trim(),
      });
    }
  }
  const showUnlinkedEvidence = reviewFilter !== "linked";
  const gridRows: RequirementGridRow[] = [
    ...requirementRows.map(({ mark, path, depth }) => ({
      kind: "requirement" as const,
      mark,
      path,
      depth,
      evidence: marks.filter(
        (item) =>
          item.side === "catalog" &&
          Boolean(mark.linkId) &&
          item.linkId === mark.linkId,
      ),
    })),
    ...(showUnlinkedEvidence
      ? unlinkedCatalogMarks.map((mark) => ({
          kind: "unassigned" as const,
          mark,
          path: "" as const,
          depth: 0 as const,
          evidence: [],
        }))
      : []),
  ];

  const getPrintableEvidenceAnnotations = (evidenceFile: UploadedFile) =>
    marks.flatMap<PdfAnnotation>((mark) => {
      if (
        mark.side !== "catalog" ||
        (mark.fileUrl && mark.fileUrl !== evidenceFile.url) ||
        (!mark.fileUrl && mark.fileName !== evidenceFile.file.name)
      ) {
        return [];
      }
      const anchor = mark.annotation ??
        (mark.area ? { x: mark.area.x, y: mark.area.y } : undefined);
      return anchor
        ? [{
            mark,
            anchor,
            requirementNo: mark.linkId
              ? requirementNumberByLinkId.get(mark.linkId)
              : undefined,
          }]
        : [];
    });

  const compareRequirementNumbers = (left: string, right: string) => {
    const leftParts = left.split(".");
    const rightParts = right.split(".");
    const partCount = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < partCount; index += 1) {
      const leftPart = leftParts[index] ?? "0";
      const rightPart = rightParts[index] ?? "0";
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);

      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        if (leftNumber !== rightNumber) return leftNumber - rightNumber;
        continue;
      }

      const fallbackComparison = leftPart.localeCompare(rightPart, undefined, {
        numeric: true,
      });
      if (fallbackComparison !== 0) return fallbackComparison;
    }

    return 0;
  };

  const getLargestLinkedRequirementLabel = (annotations: PdfAnnotation[]) =>
    annotations.reduce<string | null>((largest, annotation) => {
      const linkId = annotation.mark.linkId;
      if (!linkId) return largest;
      const requirement = rootRequirementDetailsByLinkId.get(linkId);
      if (!requirement) return largest;
      const requirementNo = requirement.requirementNo.trim();
      if (!requirementNo) return largest;
      const label = `${requirementNo} ${requirement.text}`.trim();
      if (!largest) return label;
      return compareRequirementNumbers(requirementNo, largest.split(" ")[0] ?? "") > 0
        ? label
        : largest;
    }, null);

  const getWorkspaceOutputTitle = (suffix?: string) => {
    const name = sanitizeWorkspaceName(workspaceName) || "COMPAREX workspace";
    return suffix ? `${name} - ${suffix}` : name;
  };

  const getOutputFileName = (title: string) => {
    const cleaned = title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `${cleaned || "COMPAREX annotated evidence"}.pdf`;
  };

  const downloadPdfBlob = (blob: Blob, title = getWorkspaceOutputTitle()) => {
    const fileName = getOutputFileName(title);
    const downloadUrl = URL.createObjectURL(
      new File([blob], fileName, { type: "application/pdf" }),
    );
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
  };

  const mergePdfBlobs = async (pdfBlobs: Blob[], title?: string) => {
    const { PDFDocument } = await import("pdf-lib");
    const mergedPdf = await PDFDocument.create();
    if (title) mergedPdf.setTitle(title);
    for (const blob of pdfBlobs) {
      const sourcePdf = await PDFDocument.load(await blob.arrayBuffer());
      const pages = await mergedPdf.copyPages(
        sourcePdf,
        sourcePdf.getPageIndices(),
      );
      pages.forEach((page) => mergedPdf.addPage(page));
    }
    return new Blob([Uint8Array.from(await mergedPdf.save()).buffer], {
      type: "application/pdf",
    });
  };

  const downloadAnnotatedEvidence = async () => {
    const evidenceFile = files.right;
    if (!evidenceFile || !isPdfFile(evidenceFile.file)) return;

    const annotations = getPrintableEvidenceAnnotations(evidenceFile);
    if (!annotations.length) {
      window.alert("No evidence highlights with a saved position to download.");
      return;
    }

    const outputTitle =
      getLargestLinkedRequirementLabel(annotations) ??
      getWorkspaceOutputTitle(evidenceFile.file.name.replace(/\.pdf$/i, ""));

    setIsDownloadingEvidence(true);
    try {
      const exported = await createAnnotatedPdf(
        evidenceFile.file,
        annotations,
        outputTitle,
      );
      downloadPdfBlob(exported, outputTitle);
    } catch (error) {
      window.alert(
        `Could not prepare ${evidenceFile.file.name} for download: ${getErrorMessage(error)}`,
      );
    } finally {
      setIsDownloadingEvidence(false);
    }
  };

  const downloadAllAnnotatedEvidence = async () => {
    if (!downloadableCatalogFiles.length) {
      window.alert("No loaded PDF evidence files have downloadable highlights.");
      return;
    }

    const outputTitle = getWorkspaceOutputTitle("Product Evidence");

    setIsDownloadingEvidence(true);
    try {
      const annotatedPdfs: Blob[] = [];
      const failedFiles: PrintableFileFailure[] = [];

      for (const item of downloadableCatalogFiles) {
        try {
          annotatedPdfs.push(
            await createAnnotatedPdf(
              item.file,
              getPrintableEvidenceAnnotations(item),
              getWorkspaceOutputTitle(item.file.name.replace(/\.pdf$/i, "")),
            ),
          );
        } catch (error) {
          failedFiles.push({
            fileName: item.file.name,
            reason: getErrorMessage(error),
          });
        }
      }

      if (!annotatedPdfs.length) {
        window.alert(
          `Could not prepare any annotated PDFs for download.${failedFiles.length ? ` Failed files: ${failedFiles.map((item) => `${item.fileName}: ${item.reason}`).join("; ")}` : ""}`,
        );
        return;
      }

      const exported =
        annotatedPdfs.length === 1
          ? annotatedPdfs[0]
          : await mergePdfBlobs(annotatedPdfs, outputTitle);
      downloadPdfBlob(exported, outputTitle);
      if (failedFiles.length) {
        window.alert(
          `Downloaded ${annotatedPdfs.length} file${annotatedPdfs.length === 1 ? "" : "s"}. Could not prepare: ${failedFiles.map((item) => `${item.fileName}: ${item.reason}`).join("; ")}`,
        );
      }
    } catch {
      window.alert("Could not merge the annotated PDFs for download. Please try fewer files at once.");
    } finally {
      setIsDownloadingEvidence(false);
    }
  };

  const clearProject = async () => {
    setIsClearConfirmOpen(false);
    setIsClearingProject(true);
    const handlesCleared = await clearFileHandles();
    const workspaceCleared = handlesCleared && clearPersistedWorkspace();
    if (!workspaceCleared) {
      setIsClearingProject(false);
      setRestoreMessage("Could not clear the saved project. Check browser storage access and try again.");
      return;
    }

    skipNextPersistRef.current = true;
    const urls = new Set([
      files.left?.url,
      files.right?.url,
      ...catalogFiles.map((item) => item.url),
    ]);
    urls.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    sessionFilesRef.current = { tor: null, catalogs: [] };
    setFiles({ left: null, right: null });
    setCatalogFiles([]);
    setMarks([]);
    setWorkspaceName("Untitled workspace");
    setLeftWidth(50);
    setRequirementStartPath("1");
    setIsResizing(false);
    setIsCatalogMenuOpen(false);
    setCatalogLabelOffset(null);
    setPendingLinkId(null);
    setIsReviewOpen(false);
    setIsReviewPinned(false);
    setShowTorPane(true);
    setShowEvidencePane(true);
    setReviewFilter("all");
    setDragOverTorId(null);
    setPendingJumpId(null);
    setInteractionMode("highlight");
    setCollapsedRequirements(new Set());
    setRequirementComposer(null);
    setStoredFileHint(null);
    setRestoreMessage("Project cleared. Original files remain on your device.");
    setIsClearingProject(false);
  };

  const resizePanels = (event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;

    const workspace = workspaceRef.current;
    if (!workspace) return;

    const bounds = workspace.getBoundingClientRect();
    const nextWidth = ((event.clientX - bounds.left) / bounds.width) * 100;
    setLeftWidth(Math.min(80, Math.max(20, nextWidth)));
  };

  const hasVisibleRequirementBranch = (mark: EvidenceMark): boolean =>
    visibleTorIds.has(mark.id) ||
    torMarks.some(
      (child) =>
        child.parentId === mark.id && hasVisibleRequirementBranch(child),
    );

  const renderRequirementComposer = (parentId: string | null) =>
    requirementComposer?.parentId === parentId ? (
      <form
        className="requirement-composer"
        onSubmit={(event) => {
          event.preventDefault();
          addManualRequirement();
        }}
      >
        <input
          autoFocus
          value={requirementComposer.value}
          onChange={(event) =>
            setRequirementComposer((current) =>
              current ? { ...current, value: event.target.value } : null,
            )
          }
          placeholder={parentId ? "Type sub-requirement" : "Type requirement"}
          aria-label={parentId ? "Sub-requirement text" : "Requirement text"}
        />
        <button type="submit" disabled={!requirementComposer.value.trim()}>
          Add
        </button>
        <button type="button" onClick={() => setRequirementComposer(null)}>
          Cancel
        </button>
      </form>
    ) : null;

  const renderRequirementNode = (
    torMark: EvidenceMark,
    path: string,
    depth = 0,
  ): ReactNode => {
    if (!hasVisibleRequirementBranch(torMark)) return null;

    const evidenceMarks = marks.filter(
      (mark) =>
        mark.side === "catalog" &&
        Boolean(torMark.linkId) &&
        mark.linkId === torMark.linkId,
    );
    const children = torMarks.filter((mark) => mark.parentId === torMark.id);
    const isPaired = evidenceMarks.length > 0;
    const isCollapsed = collapsedRequirements.has(torMark.id);
    const canCollapse = Boolean(children.length || evidenceMarks.length);

    return (
      <section
        className="requirement-group requirement-tree-node"
        key={torMark.id}
        role="treeitem"
        aria-expanded={canCollapse ? !isCollapsed : undefined}
        style={{ "--tree-depth": depth } as React.CSSProperties}
      >
        <div className="requirement-heading">
          <button
            className="requirement-toggle"
            type="button"
            onClick={() => toggleRequirement(torMark.id)}
            disabled={!canCollapse}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} requirement ${path}`}
            aria-expanded={!isCollapsed}
          >
            {canCollapse && isCollapsed ? (
              <ChevronRight aria-hidden="true" size={14} />
            ) : (
              <ChevronDown aria-hidden="true" size={14} />
            )}
          </button>
          <span>Requirement {path}</span>
          <small>
            {evidenceMarks.length} {evidenceMarks.length === 1 ? "evidence" : "evidence items"}
          </small>
          <button
            className="add-sub-requirement"
            type="button"
            onClick={() => setRequirementComposer({ parentId: torMark.id, value: "" })}
            aria-label={`Add sub-requirement under requirement ${path}`}
            title="Add sub-requirement"
          >
            <Plus aria-hidden="true" size={14} />
          </button>
        </div>
        <ReviewMarkItem
          mark={torMark}
          isPaired={isPaired}
          pendingLinkId={pendingLinkId}
          onLink={linkExistingMark}
          onUnlink={unlinkEvidenceMark}
          onRemove={removeEvidenceMark}
          onJump={jumpToEvidenceMark}
        />
        {!isCollapsed ? (
          <>
            {evidenceMarks.length ? (
              <div className="linked-evidence-list">
                {evidenceMarks.map((mark) => (
                  <ReviewMarkItem
                    key={mark.id}
                    mark={mark}
                    isPaired
                    pendingLinkId={pendingLinkId}
                    onLink={linkExistingMark}
                    onUnlink={unlinkEvidenceMark}
                    onRemove={removeEvidenceMark}
                    onJump={jumpToEvidenceMark}
                  />
                ))}
              </div>
            ) : null}
            <button
              className={`link-evidence-prompt ${
                dragOverTorId === torMark.id ? "drop-active" : ""
              }`}
              type="button"
              onClick={() => linkExistingMark(torMark)}
              onDragEnter={(event) => {
                if (event.dataTransfer.types.includes("application/x-comparex-evidence")) {
                  event.preventDefault();
                  setDragOverTorId(torMark.id);
                }
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("application/x-comparex-evidence")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setDragOverTorId(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                linkDroppedEvidence(
                  torMark,
                  event.dataTransfer.getData("application/x-comparex-evidence"),
                );
              }}
            >
              <Link2 aria-hidden="true" size={14} />
              {evidenceMarks.length ? "Add supporting evidence" : "Link supporting evidence"}
            </button>
            {renderRequirementComposer(torMark.id)}
            {children.length ? (
              <div className="child-requirements" role="group">
                {children.map((child, index) =>
                  renderRequirementNode(child, `${path}.${index + 1}`, depth + 1),
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    );
  };

  const linkedRequirementOrderByFileName = new Map<
    string,
    { order: number; requirementNo: string }
  >();
  allRequirementRows.forEach(({ mark, path }, order) => {
    if (!mark.linkId) return;

    const requirementNo = mark.requirementNo?.trim() || path;
    marks
      .filter(
        (item) => item.side === "catalog" && item.linkId === mark.linkId,
      )
      .forEach((item) => {
        const current = linkedRequirementOrderByFileName.get(item.fileName);
        if (!current || order < current.order) {
          linkedRequirementOrderByFileName.set(item.fileName, {
            order,
            requirementNo,
          });
        }
      });
  });

  const baseCatalogFileNames = Array.from(
    new Set([
      ...(storedFileHint?.evidenceNames ?? []),
      ...catalogFiles.map((item) => item.file.name),
      ...marks
        .filter((mark) => mark.side === "catalog")
        .map((mark) => mark.fileName),
    ]),
  );
  const catalogFileIndexByName = new Map(
    baseCatalogFileNames.map((fileName, index) => [fileName, index]),
  );
  const catalogFileNames = [...baseCatalogFileNames].sort((left, right) => {
    const leftOrder = linkedRequirementOrderByFileName.get(left);
    const rightOrder = linkedRequirementOrderByFileName.get(right);

    if (leftOrder && rightOrder) {
      return (
        leftOrder.order - rightOrder.order ||
        (catalogFileIndexByName.get(left) ?? 0) -
          (catalogFileIndexByName.get(right) ?? 0)
      );
    }

    if (leftOrder) return -1;
    if (rightOrder) return 1;

    return (
      (catalogFileIndexByName.get(left) ?? 0) -
      (catalogFileIndexByName.get(right) ?? 0)
    );
  });
  const downloadableCatalogFiles = catalogFileNames.flatMap((fileName) => {
    const item = catalogFiles.find((catalog) => catalog.file.name === fileName);
    if (!item || !isPdfFile(item.file)) return [];
    return getPrintableEvidenceAnnotations(item).length ? [item] : [];
  });
  const visibleDocumentPaneCount = Number(showTorPane) + Number(showEvidencePane);
  const workspaceVisibilityClass =
    visibleDocumentPaneCount === 0
      ? "no-document-panes"
      : visibleDocumentPaneCount === 1
        ? "one-pane"
        : "";

  return (
    <main className={`app-shell ${isReviewPinned ? "review-pinned" : ""}`}>
      <header className="topbar">
        <div className="toolbar-brand">
          <Image
            src={comparexLogo}
            alt="COMPAREX"
            width={158}
            priority
          />
        </div>

        <label className="workspace-name-control">
          <span>Project Name</span>
          <input
            type="text"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            onBlur={() =>
              setWorkspaceName((current) =>
                sanitizeWorkspaceName(current) || "Untitled workspace",
              )
            }
            aria-label="Workspace name"
          />
        </label>

        <nav className="toolbar-actions" aria-label="Workspace tools">
          <div className="interaction-mode" role="group" aria-label="Highlight interaction mode">
            <button
              type="button"
              className={interactionMode === "highlight" ? "active" : ""}
              onClick={() => {
                setInteractionMode("highlight");
                setPendingLinkId(null);
              }}
              aria-pressed={interactionMode === "highlight"}
              title="Highlight mode"
            >
              <Highlighter aria-hidden="true" size={16} />
              <span>Highlight</span>
            </button>
            <button
              type="button"
              className={interactionMode === "link" ? "active" : ""}
              onClick={() => setInteractionMode("link")}
              aria-pressed={interactionMode === "link"}
              title="Link mode"
            >
              <Link2 aria-hidden="true" size={16} />
              <span>Link</span>
            </button>
          </div>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            className={`tool-button ${isReviewOpen ? "active-tool" : ""}`}
            type="button"
            onClick={() => {
              if (isReviewOpen) {
                setIsReviewOpen(false);
                setIsReviewPinned(false);
              } else {
                setIsReviewOpen(true);
              }
            }}
            aria-expanded={isReviewOpen}
            aria-controls="review-rail"
            title="Review highlights"
          >
            <Highlighter aria-hidden="true" size={17} />
            <span>Highlights {highlightCount}</span>
          </button>
          <button
            className={`tool-button ${showTorPane ? "active-tool" : ""}`}
            type="button"
            onClick={() => setShowTorPane((current) => !current)}
            aria-pressed={showTorPane}
            aria-controls="tor-panel"
            title={showTorPane ? "Hide TOR panel" : "Show TOR panel"}
          >
            <FileText aria-hidden="true" size={17} />
            <span>TOR</span>
          </button>
          <button
            className={`tool-button ${showEvidencePane ? "active-tool" : ""}`}
            type="button"
            onClick={() => setShowEvidencePane((current) => !current)}
            aria-pressed={showEvidencePane}
            aria-controls="evidence-panel"
            title={showEvidencePane ? "Hide Product Evidence panel" : "Show Product Evidence panel"}
          >
            <FilesIcon aria-hidden="true" size={17} />
            <span>Evidence</span>
          </button>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            className="tool-button"
            type="button"
            onClick={() => void downloadAllAnnotatedEvidence()}
            disabled={isDownloadingEvidence || !downloadableCatalogFiles.length}
            aria-label="Download all annotated Product Evidence PDFs"
            title="Download all annotated PDFs"
          >
            <Download aria-hidden="true" size={17} />
            <span>{isDownloadingEvidence ? "Downloading..." : "Download all"}</span>
          </button>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            className="tool-button danger-tool"
            type="button"
            onClick={() => setIsClearConfirmOpen(true)}
            disabled={!hasRestoredWorkspace || isRestoringFiles || isDownloadingEvidence || isClearingProject}
            aria-label="Clear Project"
            title="Clear Project"
          >
            <Trash2 aria-hidden="true" size={17} />
            <span>{isClearingProject ? "Clearing..." : "Clear Project"}</span>
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
      {restoreMessage ? (
        <div className="restore-file-status" role="status">
          {restoreMessage}
          <button
            type="button"
            onClick={() => setRestoreMessage("")}
            aria-label="Dismiss restore status"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      <dialog
        ref={clearDialogRef}
        className="clear-project-dialog"
        aria-labelledby="clear-project-title"
        aria-describedby="clear-project-description"
        onCancel={() => setIsClearConfirmOpen(false)}
        onClose={() => setIsClearConfirmOpen(false)}
      >
        <h2 id="clear-project-title">Clear Project?</h2>
        <p id="clear-project-description">
          This removes the current project’s documents, requirements, highlights,
          links, and saved review state from this browser. Original files on your
          device stay where they are. This cannot be undone.
        </p>
        <div className="clear-project-actions">
          <button type="button" autoFocus onClick={() => setIsClearConfirmOpen(false)}>
            Cancel
          </button>
          <button type="button" className="clear-project-confirm" onClick={() => void clearProject()}>
            Clear Project
          </button>
        </div>
      </dialog>

      <section
        ref={workspaceRef}
        className={`workspace ${isResizing ? "resizing" : ""} ${workspaceVisibilityClass}`}
        aria-label="Document upload workspace"
        style={{ "--left-panel-width": `${leftWidth}%` } as React.CSSProperties}
      >
        {showTorPane ? (
          <DropPanel
            id="tor-panel"
            title="TOR / Requirements"
            tone="version-a"
            uploadedFile={files.left}
            onSelect={(documents) => setFileForSlot("left", documents[0])}
            onClear={() => clearFileForSlot("left")}
            previewProps={{
              side: "tor",
              pendingLinkId,
              interactionMode,
              marks: marks.filter(
                (mark) => mark.side === "tor" && mark.fileName === files.left?.file.name,
              ),
              onCreateMark: createEvidenceMark,
              onMoveMark: (id, labelPosition) =>
                setMarks((current) =>
                  current.map((mark) =>
                    mark.id === id ? { ...mark, labelPosition } : mark,
                  ),
                ),
            }}
          />
        ) : null}
        {showTorPane && showEvidencePane ? (
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
        ) : null}
        {showEvidencePane ? (
          <DropPanel
            id="evidence-panel"
            title="Product Evidence"
            tone="version-b"
            multiple
            uploadedFile={files.right}
            onSelect={addCatalogFiles}
            previewProps={{
              side: "catalog",
              pendingLinkId,
              interactionMode,
              marks: marks.filter(
                (mark) => mark.side === "catalog" && mark.fileName === files.right?.file.name,
              ),
              requirementNumberByLinkId,
              onMoveMark: (id, labelPosition, labelOffset) => {
                setCatalogLabelOffset(labelOffset);
                setMarks((current) =>
                  current.map((mark) =>
                    mark.id === id ? { ...mark, labelPosition } : mark,
                  ),
                );
              },
              onCreateMark: createEvidenceMark,
            }}
            toolbar={
            <div className="catalog-toolbar">
              <div className="catalog-title" title={files.right?.file.name}>
                <FileText aria-hidden="true" size={15} />
                <span>{files.right?.file.name ?? "Product Evidence"}</span>
              </div>

              <details
                className="catalog-switcher"
                ref={catalogMenuRef}
                open={isCatalogMenuOpen}
                onToggle={(event) =>
                  setIsCatalogMenuOpen(event.currentTarget.open)
                }
              >
                <summary title="All Product Evidence documents">
                  <FilesIcon aria-hidden="true" size={15} />
                  <span>Files {catalogFileNames.length}</span>
                  <ChevronDown aria-hidden="true" size={14} />
                </summary>
                <div className="catalog-popover">
                  <div className="catalog-popover-heading">
                    <div>
                      <strong>Product Evidence</strong>
                      <span>{catalogFileNames.length} documents</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCatalogMenuOpen(false)}
                      aria-label="Close document switcher"
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  </div>

                  <div className="catalog-list">
                    {catalogFileNames.length ? (
                      catalogFileNames.map((fileName) => {
                        const item = catalogFiles.find(
                          (catalog) => catalog.file.name === fileName,
                        );
                        const linkedRequirement =
                          linkedRequirementOrderByFileName.get(fileName);
                        const fileStatus = item
                          ? `${isPdfFile(item.file) ? "PDF" : "DOCX"} · ${formatFileSize(item.file.size)}`
                          : "Waiting for file permission";

                        return (
                          <div
                            className={`catalog-row ${
                              item && files.right?.url === item.url ? "active" : ""
                            } ${item ? "" : "pending"}`}
                            key={item?.url ?? fileName}
                          >
                            <button
                              className="catalog-row-main"
                              type="button"
                              onClick={() => {
                                if (!item) {
                                  void handleRestoreFiles();
                                  return;
                                }
                                setFiles((current) => ({
                                  ...current,
                                  right: item,
                                }));
                                setIsCatalogMenuOpen(false);
                              }}
                            >
                              <FileText aria-hidden="true" size={18} />
                              <span>
                                <strong>{fileName}</strong>
                                <small>
                                  {linkedRequirement
                                    ? `${fileStatus} · Req ${linkedRequirement.requirementNo}`
                                    : fileStatus}
                                </small>
                              </span>
                            </button>
                            {item ? (
                              <button
                                className="catalog-row-remove"
                                type="button"
                                onClick={() => removeCatalogFile(item)}
                                aria-label={`Remove ${item.file.name}`}
                                title="Remove document"
                              >
                                <Trash2 aria-hidden="true" size={15} />
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <p className="catalog-empty">No evidence documents yet</p>
                    )}
                  </div>

                  <button
                    className="catalog-add-button"
                    type="button"
                    onClick={() => void openCatalogPicker()}
                  >
                    <Plus aria-hidden="true" size={16} />
                    Add documents
                  </button>
                </div>
              </details>

              <button
                className="catalog-quick-add"
                type="button"
                onClick={() => void openCatalogPicker()}
                aria-label="Add Product Evidence documents"
                title="Add documents"
              >
                <Plus aria-hidden="true" size={16} />
              </button>
              <button
                className="catalog-download-button"
                type="button"
                onClick={() => void downloadAnnotatedEvidence()}
                disabled={
                  isDownloadingEvidence ||
                  !files.right ||
                  !isPdfFile(files.right.file) ||
                  !marks.some(
                    (mark) =>
                      mark.side === "catalog" &&
                      ((mark.fileUrl && mark.fileUrl === files.right?.url) ||
                        (!mark.fileUrl && mark.fileName === files.right?.file.name)) &&
                      Boolean(mark.linkId && requirementNumberByLinkId.has(mark.linkId)),
                  )
                }
                aria-label="Download annotated Product Evidence PDF"
                title="Download annotated PDF"
              >
                <Download aria-hidden="true" size={16} />
              </button>
              <input
                ref={catalogPickerRef}
                className="sr-only"
                type="file"
                multiple
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  const accepted = selected.filter(isAcceptedFile);
                  if (accepted.length) {
                    addCatalogFiles(accepted.map((file) => ({ file })));
                  }
                  event.target.value = "";
                }}
              />
            </div>
            }
          />
        ) : null}
        {!showTorPane && !showEvidencePane ? (
          <div className="workspace-empty-state" role="status">
            <strong>No document panes shown</strong>
            <span>Use the TOR or Evidence buttons in the toolbar to show a pane.</span>
          </div>
        ) : null}
      </section>
      {interactionMode === "link" ? (
        <div className="link-mode-status" role="status">
          <Link2 aria-hidden="true" size={16} />
          {pendingLinkId
            ? "Drag supporting text or area to link"
            : "Drag a TOR requirement to start linking"}
          <button type="button" onClick={() => {
            setPendingLinkId(null);
            setInteractionMode("highlight");
          }}>
            Cancel
          </button>
        </div>
      ) : null}
      <aside
        id="review-rail"
        className={`review-rail ${isReviewOpen ? "open" : ""} ${
          isReviewPinned ? "pinned" : ""
        }`}
        aria-hidden={!isReviewOpen}
      >
        <header>
          <div className="review-rail-title">
            <strong>Review highlights</strong>
            <span>{torMarks.length} requirements · {highlightCount} highlights</span>
          </div>
          <div className="review-rail-actions">
            <button
              type="button"
              onClick={() => setIsReviewPinned((current) => !current)}
              aria-label={isReviewPinned ? "Unpin review rail" : "Pin review rail"}
              aria-pressed={isReviewPinned}
              title={isReviewPinned ? "Unpin panel" : "Pin panel"}
            >
              {isReviewPinned ? (
                <PinOff aria-hidden="true" size={17} />
              ) : (
                <Pin aria-hidden="true" size={17} />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsReviewOpen(false);
                setIsReviewPinned(false);
              }}
              aria-label="Close review rail"
              title="Close panel"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        </header>
        <div className="review-filters" role="tablist" aria-label="Filter highlights">
          {(["all", "unlinked", "linked"] as ReviewFilter[]).map((filter) => (
            <button
              type="button"
              role="tab"
              aria-selected={reviewFilter === filter}
              className={reviewFilter === filter ? "active" : ""}
              key={filter}
              onClick={() => setReviewFilter(filter)}
            >
              {filter === "all"
                ? `All ${highlightCount}`
                : filter === "unlinked"
                  ? `Unlinked ${unlinkedCount}`
                  : `Linked ${linkedCount}`}
            </button>
          ))}
        </div>
        <div className="review-list">
          <div className="requirement-list-toolbar">
            <strong>Requirements</strong>
            <label className="requirement-start-control">
              <span>Start no.</span>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9๐-๙]+(\\.[0-9๐-๙]+)*"
                value={requirementStartPath}
                onChange={(event) => {
                  setRequirementStartPath(event.target.value);
                }}
                onBlur={() =>
                  setRequirementStartPath((current) =>
                    normalizeRequirementStartPath(current),
                  )
                }
              />
            </label>
            <button
              type="button"
              onClick={() => setRequirementComposer({ parentId: null, value: "" })}
            >
              <Plus aria-hidden="true" size={14} />
              Add requirement
            </button>
          </div>
          {requirementComposer
            ? renderRequirementComposer(requirementComposer.parentId)
            : null}
          <RequirementGrid
            rows={gridRows}
            showStartHint={!marks.length}
            onJump={jumpToEvidenceMark}
            onUnlink={unlinkEvidenceMark}
            onDropEvidence={linkDroppedEvidence}
            onAddRequirement={(title) => createManualRequirement(title)}
            onAddRequirements={createManualRequirements}
            onRenameRequirement={renameRequirement}
            onRenameRequirementNo={renameRequirementNo}
            onChangeParent={changeRequirementParent}
            isLinkMode={interactionMode === "link"}
            onSelectForLink={linkExistingMark}
            onDeleteRequirements={removeRequirements}
            onRemoveUnassignedEvidence={removeEvidenceMark}
          />
          {marks.length && !visibleTorMarks.length &&
          !(showUnlinkedEvidence && unlinkedCatalogMarks.length) ? (
            <p className="review-empty">No highlights match this filter.</p>
          ) : null}
        </div>
      </aside>
    </main>
  );
}
