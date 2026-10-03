"use client";

import {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
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
  FolderOpen,
  Table2,
  GripVertical,
  Highlighter,
  Link2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
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
  readWorkspaceIndex,
  saveWorkspaceIndex,
  workspaceHandleKey,
  workspaceStateKey,
  type WorkspaceIndex,
} from "./workspaceStore.mts";
import {
  closeWorkspaceTab,
  emptyWorkspaceTabs,
  initialWorkspaceTabs,
  moveWorkspaceTab,
  openWorkspaceTab,
  removeWorkspaceDocumentTabs,
  restoreReviewTableTabs,
  reviewTableId,
  type PaneTabs,
  type WorkspaceTabs,
} from "./workspaceTabs.mts";
import {
  addWorkspaceLink,
  removeWorkspaceLinkBetween,
  removeWorkspaceLinksForItems,
  type WorkspaceLink,
} from "./workspaceLinks.mts";
import { columnLinkColor, resolveLinkColor, sanitizeColumnLinkColors } from "./linkColors.mts";
import type { LinkColor } from "./linkColors.mts";
import { colorsByTableColumns, moveTableRows, nextAvailableLinkColumn, nextRequirementRowId, requirementNumbersByEvidenceMark, tableLinkSlotsForRow, unassignedTableHighlights } from "./workspaceTable.mts";
import { explorerDisplayName } from "./explorerName.mts";
import { latestRequirementTextPlacement, removeRequirementTextPlacements, sanitizeRequirementTextPlacements, type RequirementTextPlacement } from "./requirementText.mts";

const PdfPreview = dynamic(() => import("./PdfPreview"), {
  ssr: false,
  loading: () => <p className="preview-status">Loading viewer...</p>,
});

const RequirementGrid = dynamic(() => import("./RequirementGrid"), {
  ssr: false,
  loading: () => <p className="review-empty">Loading requirements...</p>,
});

type Slot = "left" | "right";
const paneLabel = (slot: Slot) => slot === "left" ? "left pane" : "right pane";
const WORKSPACE_TAB_DRAG_TYPE = "application/x-comparex-tab";
const readDraggedWorkspaceTab = (event: DragEvent<HTMLElement>) => {
  const data = event.dataTransfer.getData(WORKSPACE_TAB_DRAG_TYPE);
  const separator = data.indexOf(":");
  const from = data.slice(0, separator);
  const id = data.slice(separator + 1);
  return (from === "left" || from === "right") && id ? { from: from as Slot, id } : null;
};
type DocumentView = { page: number; scale: number };

type UploadedFile = {
  id: string;
  file: File;
  url: string;
};

type WorkspaceDocument = {
  id: string;
  name: string;
  sourceName: string;
  size: number | null;
  sha256?: string;
  pageCount?: number;
  handleKey: string;
};

type ReviewTableItem = { id: string; name: string; kind: "review-table"; linkColumnCount?: number; linkColumnColors?: Record<string, LinkColor> };
type EditorItem = { id: string; name: string; kind: "pdf" | "review-table" };

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

export default function Home() {
  const [workspaceIndex, setWorkspaceIndex] = useState<WorkspaceIndex | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const indexRef = useRef<WorkspaceIndex | null>(null);

  const applyIndex = useCallback((next: WorkspaceIndex) => {
    saveWorkspaceIndex(window.localStorage, next);
    indexRef.current = next;
    setWorkspaceIndex(next);
  }, []);

  useEffect(() => {
    try {
      const next = readWorkspaceIndex(
        window.localStorage,
        () => crypto.randomUUID(),
        () => new Date().toISOString(),
      );
      indexRef.current = next;
      setWorkspaceIndex(next);
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    }
  }, []);

  const openWorkspace = (id: string) => {
    const current = indexRef.current;
    if (!current || !current.items.some((item) => item.id === id)) return;
    try {
      applyIndex({ ...current, activeId: id });
      setShowCreate(false);
      setWorkspaceError("");
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    }
  };

  const closeWorkspace = () => {
    const current = indexRef.current;
    if (!current) return;
    try {
      applyIndex({ ...current, activeId: null });
      setShowCreate(false);
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    }
  };

  const newWorkspace = () => {
    closeWorkspace();
    setNewName("");
    setShowCreate(true);
  };

  const createWorkspace = () => {
    const current = indexRef.current;
    if (!current) return;
    const id = crypto.randomUUID();
    const name = sanitizeWorkspaceName(newName) || "Untitled workspace";
    try {
      applyIndex({
        ...current,
        activeId: id,
        items: [{ id, name, savedAt: new Date().toISOString() }, ...current.items],
      });
      setShowCreate(false);
      setWorkspaceError("");
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    }
  };

  const workspaceSaved = useCallback((id: string, name: string, savedAt: string) => {
    const current = indexRef.current;
    if (!current) return;
    const next = {
      ...current,
      items: current.items.map((item) =>
        item.id === id
          ? { ...item, name: sanitizeWorkspaceName(name) || "Untitled workspace", savedAt }
          : item,
      ),
    };
    try {
      saveWorkspaceIndex(window.localStorage, next);
      indexRef.current = next;
      setWorkspaceIndex(next);
    } catch {
      setWorkspaceError("Could not update the workspace list in browser storage.");
    }
  }, []);

  const deleteWorkspace = async (id: string) => {
    const current = indexRef.current;
    const target = current?.items.find((item) => item.id === id);
    if (!current || !target || !window.confirm(
      `Delete “${target.name}” and its local review data? Original PDF files remain on your device.`,
    )) return;
    let snapshot: string | null = null;
    let snapshotRemoved = false;
    try {
      snapshot = window.localStorage.getItem(workspaceStateKey(id));
      const saved = snapshot ? JSON.parse(snapshot) as PersistedWorkspaceState : null;
      const keys = saved?.documents?.map((item) => item.handleKey) ?? [
        ...(saved?.files?.torName ? ["tor"] : []),
        ...(saved?.files?.evidenceNames ?? []).map((name) => `catalog:${name}`),
      ];
      if (!await clearFileHandles(keys)) throw new Error("Could not remove saved file access.");
      window.localStorage.removeItem(workspaceStateKey(id));
      snapshotRemoved = true;
      applyIndex({
        ...current,
        activeId: current.activeId === id ? null : current.activeId,
        items: current.items.filter((item) => item.id !== id),
      });
    } catch (error) {
      if (snapshotRemoved && snapshot) {
        try { window.localStorage.setItem(workspaceStateKey(id), snapshot); } catch { /* Preserve the error below. */ }
      }
      setWorkspaceError(getErrorMessage(error));
      window.alert(`Could not delete this workspace: ${getErrorMessage(error)}`);
    }
  };

  if (!workspaceIndex) {
    return <main className="workspace-start"><p role="status">{workspaceError || "Opening workspaces..."}</p></main>;
  }

  if (workspaceIndex.activeId && !showCreate) {
    return (
      <ReviewWorkspace
        key={workspaceIndex.activeId}
        workspaceId={workspaceIndex.activeId}
        initialName={workspaceIndex.items.find((item) => item.id === workspaceIndex.activeId)?.name ?? "Untitled workspace"}
        workspaces={workspaceIndex.items}
        onWorkspaceSaved={workspaceSaved}
        onOpenWorkspace={openWorkspace}
        onNewWorkspace={newWorkspace}
        onCloseWorkspace={closeWorkspace}
        onDeleteWorkspace={(id) => void deleteWorkspace(id)}
      />
    );
  }

  return (
    <main className="workspace-start">
      <header className="workspace-start-header">
        <Image src={comparexLogo} alt="COMPAREX" width={158} priority />
        <span>Local PDF workspaces</span>
      </header>
      <section className="workspace-start-content" aria-labelledby="workspaces-title">
        <div className="workspace-start-heading">
          <div>
            <h1 id="workspaces-title">Workspaces</h1>
            <p>Open a recent review or create a workspace with a Review Table and PDF documents.</p>
          </div>
          {!showCreate ? <button type="button" onClick={newWorkspace}><Plus size={17} aria-hidden="true" /> New Workspace</button> : null}
        </div>
        {workspaceError ? <p className="error-message" role="alert">{workspaceError}</p> : null}
        {showCreate ? (
          <form className="workspace-create" onSubmit={(event) => { event.preventDefault(); createWorkspace(); }}>
            <label htmlFor="new-workspace-name">Workspace name</label>
            <input
              id="new-workspace-name"
              autoFocus
              value={newName}
              maxLength={80}
              placeholder="Untitled workspace"
              onChange={(event) => setNewName(event.target.value)}
            />
            <p>You can add PDFs after creating the workspace.</p>
            <div>
              <button type="button" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit">Create Workspace</button>
            </div>
          </form>
        ) : workspaceIndex.items.length ? (
          <ul className="workspace-recent-list">
            {[...workspaceIndex.items].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => openWorkspace(item.id)}>
                  <FolderOpen size={20} aria-hidden="true" />
                  <span><strong>{item.name}</strong><small>Saved locally · {new Date(item.savedAt).toLocaleString()}</small></span>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
                <button type="button" className="workspace-recent-remove" onClick={() => void deleteWorkspace(item.id)} aria-label={`Delete ${item.name}`} title="Delete workspace"><Trash2 size={16} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : <p className="workspace-start-empty">No workspaces yet. Create one to begin reviewing PDFs.</p>}
      </section>
    </main>
  );
}

type ReviewFilter = "all" | "unlinked" | "linked";

const acceptedExtensions = [".pdf"];
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
  version: 1 | 2;
  savedAt: string;
  workspaceName?: string;
  marks: EvidenceMark[];
  textPlacements?: RequirementTextPlacement[];
  links?: WorkspaceLink[];
  panel: {
    leftWidth: number;
    isReviewOpen: boolean;
    isReviewPinned: boolean;
    showTorPane?: boolean;
    showEvidencePane?: boolean;
    reviewFilter: ReviewFilter;
    reviewView?: "highlights" | "rows";
    interactionMode: "highlight" | "link";
    documentViews?: Record<string, DocumentView>;
    explorerWidth?: number;
  };
  catalogLabelOffset: { x: number; y: number } | null;
  collapsedRequirementIds: string[];
  files: {
    torName: string | null;
    activeEvidenceName: string | null;
    evidenceNames: string[];
  };
  documents?: WorkspaceDocument[];
  reviewTable?: ReviewTableItem;
  tabs?: WorkspaceTabs;
};

function isAcceptedFile(file: File) {
  const name = file.name.toLowerCase();
  return acceptedExtensions.some((extension) => name.endsWith(extension));
}

function isPdfFile(file: File) {
  return file.name.toLowerCase().endsWith(".pdf");
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function readPersistedWorkspace(workspaceId: string): PersistedWorkspaceState | null {
  const raw = window.localStorage.getItem(workspaceStateKey(workspaceId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
    if (parsed.version !== 1 && parsed.version !== 2) throw new Error("Unsupported workspace format");
    return parsed as PersistedWorkspaceState;
  } catch {
    throw new Error("Saved workspace data could not be read. It was kept unchanged.");
  }
}

function writePersistedWorkspace(workspaceId: string, state: PersistedWorkspaceState) {
  try {
    window.localStorage.setItem(workspaceStateKey(workspaceId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function clearPersistedWorkspace(workspaceId: string) {
  try {
    window.localStorage.removeItem(workspaceStateKey(workspaceId));
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

async function clearFileHandles(keys: string[]) {
  if (!("indexedDB" in window)) return true;
  try {
    const database = await openFileHandleDatabase();
    return await new Promise<boolean>((resolve) => {
      const transaction = database.transaction(fileHandleStoreName, "readwrite");
      const store = transaction.objectStore(fileHandleStoreName);
      keys.forEach((key) => store.delete(key));
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
  missingDocument,
  multiple = false,
  onSelect,
  onOpenDocumentDrop,
  onMoveTabDrop,
  onClear,
  toolbar,
  previewProps,
}: {
  id?: string;
  title: string;
  tone: "version-a" | "version-b";
  uploadedFile: UploadedFile | null;
  missingDocument?: string;
  multiple?: boolean;
  onSelect: (documents: SelectedDocument[]) => void;
  onOpenDocumentDrop?: (documentId: string) => void;
  onMoveTabDrop?: (from: Slot, documentId: string) => void;
  onClear?: () => void;
  toolbar?: ReactNode;
  previewProps?: {
    side: "tor" | "catalog";
    pendingLinkId: string | null;
    interactionMode: "highlight" | "link";
    evidenceTargetRowId?: string | null;
    marks: EvidenceMark[];
    neutralLinking?: boolean;
    onStatusChange?: (status: "opening" | "ready" | "error", pageCount?: number, message?: string) => void;
    initialView?: DocumentView;
    onViewChange?: (view: DocumentView) => void;
    requirementNumberByLinkId?: ReadonlyMap<string, string>;
    requirementNumbersByMarkId?: ReadonlyMap<string, readonly string[]>;
    colorsByMarkId?: ReadonlyMap<string, readonly LinkColor[]>;
    textPlacements?: RequirementTextPlacement[];
    textPlacementTarget?: { rowId: string; text: string } | null;
    onPlaceText?: (page: number, x: number, y: number) => boolean;
    onMoveTextPlacement?: (id: string, x: number, y: number, scale?: number) => void;
    onRemoveTextPlacement?: (id: string) => void;
    onCreateMark: (mark: EvidenceMark, intent: "highlight" | "link") => void;
    onMoveMark?: (
      id: string,
      position: { x: number; y: number },
      offset: { x: number; y: number },
    ) => void;
    onAutoPlaceMark?: (id: string, position: { x: number; y: number }) => void;
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
        ? `ไม่เพิ่ม ${rejected} ไฟล์: รองรับเฉพาะ PDF`
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
              description: "PDF documents",
              accept: { "application/pdf": [".pdf"] },
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
    const tab = readDraggedWorkspaceTab(event);
    if (tab && onMoveTabDrop) {
      onMoveTabDrop(tab.from, tab.id);
      return;
    }
    const documentId = event.dataTransfer.getData("application/x-comparex-document");
    if (documentId && onOpenDocumentDrop) {
      onOpenDocumentDrop(documentId);
      return;
    }
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
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          tabIndex={-1}
          multiple={multiple}
          accept=".pdf,application/pdf"
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
              evidenceTargetRowId={previewProps?.evidenceTargetRowId}
              marks={previewProps?.marks ?? []}
              neutralLinking={previewProps?.neutralLinking}
              onStatusChange={previewProps?.onStatusChange}
              initialView={previewProps?.initialView}
              onViewChange={previewProps?.onViewChange}
              requirementNumberByLinkId={previewProps?.requirementNumberByLinkId}
              requirementNumbersByMarkId={previewProps?.requirementNumbersByMarkId}
              colorsByMarkId={previewProps?.colorsByMarkId}
              textPlacements={previewProps?.textPlacements}
              textPlacementTarget={previewProps?.textPlacementTarget}
              onPlaceText={previewProps?.onPlaceText}
              onMoveTextPlacement={previewProps?.onMoveTextPlacement}
              onRemoveTextPlacement={previewProps?.onRemoveTextPlacement}
              onCreateMark={previewProps?.onCreateMark ?? (() => undefined)}
              onMoveMark={previewProps?.onMoveMark}
              onAutoPlaceMark={previewProps?.onAutoPlaceMark}
            />
          ) : (
            <div className="file-state">
              <div className="file-icon" aria-hidden="true">
                FILE
              </div>
              <div className="file-details">
                <strong>{uploadedFile.file.name}</strong>
                <span>{formatFileSize(uploadedFile.file.size)}</span>
              </div>
              <span className="docx-note">
                This document cannot be previewed. Add a PDF to continue.
              </span>
            </div>
          )
        ) : missingDocument ? (
          <div className="empty-state">
            <strong>Cannot open {missingDocument}</strong>
            <span>Select the original PDF again in Explorer to restore access.</span>
          </div>
        ) : (
          <div className="empty-state">
            <strong>Drag & Drop PDF here</strong>
            <span>ลากไฟล์มาวางได้ทั่วช่องนี้ หรือ</span>
            <button
              className="upload-select-button"
              type="button"
              onClick={() => void openPicker()}
              aria-label={`เลือก PDF ใน ${title}`}
            >
              <Plus size={17} aria-hidden="true" />
              เลือก PDF
            </button>
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

function EditorTabs({
  slot,
  pane,
  documents,
  onOpen,
  onClose,
  onMove,
  onAdd,
  onDownload,
}: {
  slot: Slot;
  pane: PaneTabs;
  documents: EditorItem[];
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (from: Slot, id: string) => void;
  onAdd: () => void;
  onDownload: () => void;
}) {
  const [isTabDropTarget, setIsTabDropTarget] = useState(false);
  return (
    <div
      className={`editor-tabs ${isTabDropTarget ? "tab-drop-target" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKSPACE_TAB_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setIsTabDropTarget(true);
        } else if (event.dataTransfer.types.includes("application/x-comparex-document")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsTabDropTarget(false);
      }}
      onDrop={(event) => {
        const tab = readDraggedWorkspaceTab(event);
        if (tab) {
          event.preventDefault();
          event.stopPropagation();
          setIsTabDropTarget(false);
          onMove(tab.from, tab.id);
          return;
        }
        const id = event.dataTransfer.getData("application/x-comparex-document");
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        onOpen(id);
      }}
    >
      <div className="editor-tab-list" role="tablist" aria-label={`${paneLabel(slot)} documents`}>
        {pane.openIds.map((id) => {
          const document = documents.find((item) => item.id === id);
          if (!document) return null;
          return (
            <div className={`editor-tab ${pane.activeId === id ? "active" : ""}`} key={id}>
              <button
                type="button"
                role="tab"
                aria-selected={pane.activeId === id}
                aria-keyshortcuts={slot === "left" ? "Alt+Shift+ArrowRight" : "Alt+Shift+ArrowLeft"}
                title={`${document.name} · drag to the other pane or press Alt+Shift+${slot === "left" ? "Right" : "Left"}`}
                onClick={() => onOpen(id)}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(WORKSPACE_TAB_DRAG_TYPE, `${slot}:${id}`);
                }}
                onKeyDown={(event) => {
                  const direction = slot === "left" ? "ArrowRight" : "ArrowLeft";
                  if (event.altKey && event.shiftKey && event.key === direction) {
                    event.preventDefault();
                    onMove(slot, id);
                  }
                }}
              >
                {document.kind === "review-table" ? <Table2 size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                <span>{document.name}</span>
              </button>
              <button type="button" className="editor-tab-close" onClick={() => onClose(id)} aria-label={`Close ${document.name} in ${paneLabel(slot)}`}>
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="editor-add" onClick={onAdd} aria-label={`Add PDF to ${paneLabel(slot)}`} title="Add PDF">
        <Plus size={16} aria-hidden="true" />
      </button>
      <button type="button" className="editor-add" onClick={onDownload} disabled={!pane.activeId || documents.find((item) => item.id === pane.activeId)?.kind !== "pdf"} aria-label={`Download annotated PDF from ${paneLabel(slot)}`} title="Download annotated PDF">
        <Download size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function ReviewWorkspace({
  workspaceId,
  initialName,
  workspaces,
  onWorkspaceSaved,
  onOpenWorkspace,
  onNewWorkspace,
  onCloseWorkspace,
  onDeleteWorkspace,
}: {
  workspaceId: string;
  initialName: string;
  workspaces: WorkspaceIndex["items"];
  onWorkspaceSaved: (id: string, name: string, savedAt: string) => void;
  onOpenWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onCloseWorkspace: () => void;
  onDeleteWorkspace: (id: string) => void;
}) {
  const [files, setFiles] = useState<Record<Slot, UploadedFile | null>>({
    left: null,
    right: null,
  });
  const [workspaceName, setWorkspaceName] = useState(initialName);
  const [leftWidth, setLeftWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [catalogFiles, setCatalogFiles] = useState<UploadedFile[]>([]);
  const [documentStatuses, setDocumentStatuses] = useState<Record<string, { status: "opening" | "ready" | "error"; message?: string }>>({});
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [reviewTableName, setReviewTableName] = useState("Review Table");
  const [linkColumnCount, setLinkColumnCount] = useState(1);
  const [linkColumnColors, setLinkColumnColors] = useState<Record<string, LinkColor>>({});
  const tableId = reviewTableId(workspaceId);
  const [tabs, setTabs] = useState<WorkspaceTabs>(() => initialWorkspaceTabs(workspaceId));
  const [documentViews, setDocumentViews] = useState<Record<string, DocumentView>>({});
  const [activePane, setActivePane] = useState<Slot>("left");
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(300);
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);
  const [openExplorerMenuId, setOpenExplorerMenuId] = useState<string | null>(null);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [renamingDocumentValue, setRenamingDocumentValue] = useState("");
  const [focusTableMarkId, setFocusTableMarkId] = useState<string | null>(null);
  const [focusEvidenceMarkId, setFocusEvidenceMarkId] = useState<string | null>(null);
  const [activeEvidenceRowId, setActiveEvidenceRowId] = useState<string | null>(null);
  const [activeTextRowId, setActiveTextRowId] = useState<string | null>(null);
  const [placedTextMenu, setPlacedTextMenu] = useState<{ rowId: string; left: number; top: number } | null>(null);
  const placedTextMenuRef = useRef<HTMLDivElement>(null);
  const placedTextReturnFocusRef = useRef<HTMLElement | null>(null);
  const [activeLinkColumn, setActiveLinkColumn] = useState<number | null>(null);
  const [autoAdvanceEvidence, setAutoAdvanceEvidence] = useState(true);
  const [autoAdvanceNotice, setAutoAdvanceNotice] = useState("");
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isRenamingWorkspace, setIsRenamingWorkspace] = useState(false);
  const [isDownloadingEvidence, setIsDownloadingEvidence] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearingProject, setIsClearingProject] = useState(false);
  const [marks, setMarks] = useState<EvidenceMark[]>([]);
  const [textPlacements, setTextPlacements] = useState<RequirementTextPlacement[]>([]);
  const [links, setLinks] = useState<WorkspaceLink[]>([]);
  const [pendingLinkSourceId, setPendingLinkSourceId] = useState<string | null>(null);
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
  const [pendingJumpSlot, setPendingJumpSlot] = useState<Slot | null>(null);
  const [pendingPlacementJumpId, setPendingPlacementJumpId] = useState<string | null>(null);
  const [pendingPlacementJumpSlot, setPendingPlacementJumpSlot] = useState<Slot | null>(null);
  const [interactionMode, setInteractionMode] = useState<"highlight" | "link">("highlight");
  const [collapsedRequirements, setCollapsedRequirements] = useState<Set<string>>(
    new Set(),
  );
  const [requirementComposer, setRequirementComposer] = useState<{
    parentId: string | null;
    value: string;
  } | null>(null);
  const [hasRestoredWorkspace, setHasRestoredWorkspace] = useState(false);
  const [fatalRestoreError, setFatalRestoreError] = useState("");
  const [isRestoringFiles, setIsRestoringFiles] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  const sessionFilesRef = useRef<{
    tor: UploadedFile | null;
    catalogs: UploadedFile[];
  }>({ tor: null, catalogs: [] });
  const workspaceRef = useRef<HTMLElement>(null);
  const workbenchBodyRef = useRef<HTMLDivElement>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const skipNextPersistRef = useRef(false);
  const explorerPickerRef = useRef<HTMLInputElement>(null);
  const reattachTargetRef = useRef<WorkspaceDocument | null>(null);
  const replaceTargetRef = useRef<WorkspaceDocument | null>(null);
  const pickerSlotRef = useRef<Slot>("left");
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const renameOriginalRef = useRef("");
  const cancelDocumentRenameRef = useRef(false);

  useEffect(() => {
    if (!activeEvidenceRowId) return;
    const tableIsVisible = tabs.left.activeId === tableId || tabs.right.activeId === tableId;
    const rowExists = marks.some((mark) =>
      mark.id === activeEvidenceRowId && mark.reviewRole !== "highlight" && !mark.referenceOnly,
    );
    if (!tableIsVisible || !rowExists) {
      setActiveEvidenceRowId(null);
      setActiveLinkColumn(null);
      setAutoAdvanceEvidence(false);
      setAutoAdvanceNotice("");
    }
  }, [activeEvidenceRowId, marks, tableId, tabs.left.activeId, tabs.right.activeId]);

  useEffect(() => {
    if (!activeTextRowId) return;
    const tableIsVisible = tabs.left.activeId === tableId || tabs.right.activeId === tableId;
    if (!tableIsVisible || !marks.some((mark) => mark.id === activeTextRowId)) setActiveTextRowId(null);
  }, [activeTextRowId, marks, tableId, tabs.left.activeId, tabs.right.activeId]);

  useEffect(() => {
    if (interactionMode === "link") setActiveTextRowId(null);
  }, [interactionMode]);

  const recordDocumentStatus = useCallback((
    id: string,
    status: "opening" | "ready" | "error",
    pageCount?: number,
    message?: string,
  ) => {
    setDocumentStatuses((current) => {
      const previous = current[id];
      return previous?.status === status && previous?.message === message
        ? current
        : { ...current, [id]: { status, message } };
    });
    if (status === "ready" && pageCount) {
      setDocuments((current) => current.some((entry) => entry.id === id && entry.pageCount !== pageCount)
        ? current.map((entry) => entry.id === id ? { ...entry, pageCount } : entry)
        : current,
      );
    }
  }, []);

  const restoreFilesFromHandles = async (
    entries: WorkspaceDocument[],
    nextTabs: WorkspaceTabs,
    isCancelled: () => boolean = () => false,
  ): Promise<RestoreFilesResult> => {
    const available: UploadedFile[] = [];
    const verifiedDetails = new Map<string, { size: number; sha256: string }>();
    for (const entry of entries) {
      if (isCancelled()) break;
      const alreadyOpen = catalogFiles.find((item) => item.id === entry.id);
      if (alreadyOpen) {
        available.push(alreadyOpen);
        continue;
      }
      try {
        const record = await readFileHandle(entry.handleKey);
        const file = record ? await getReadableFileFromHandle(record) : null;
        if (!file || !isPdfFile(file) || file.size > 100 * 1024 * 1024 ||
          new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== "%PDF-") continue;
        const sha256 = await sha256File(file);
        if (entry.sha256 && sha256 !== entry.sha256) continue;
        verifiedDetails.set(entry.id, { size: file.size, sha256 });
        available.push({ id: entry.id, file, url: URL.createObjectURL(file) });
      } catch {
        // Keep the document and its marks visible as unresolved in Explorer.
      }
    }
    if (isCancelled()) {
      available.forEach((item) => URL.revokeObjectURL(item.url));
      return { attempted: entries.length, restored: 0 };
    }
    if (verifiedDetails.size) setDocuments((current) => current.map((entry) => {
      const details = verifiedDetails.get(entry.id);
      return details ? { ...entry, ...details } : entry;
    }));
    setCatalogFiles((current) => [
      ...current.filter((item) => !available.some((restoredItem) => restoredItem.id === item.id)),
      ...available,
    ]);
    setFiles((current) => ({
      left: available.find((item) => item.id === nextTabs.left.activeId) ?? current.left,
      right: available.find((item) => item.id === nextTabs.right.activeId) ?? current.right,
    }));
    setMarks((current) =>
      current.map((mark) => {
        const item = available.find((candidate) =>
          mark.documentId
            ? candidate.id === mark.documentId
            : candidate.file.name === mark.fileName,
        );
        return item ? { ...mark, documentId: item.id, fileUrl: item.url } : mark;
      }),
    );
    return { attempted: entries.length, restored: available.length };
  };

  const legacyDocuments = (state: PersistedWorkspaceState) => {
    const entries: WorkspaceDocument[] = [];
    const torName = state.files?.torName;
    if (torName) entries.push({
      id: crypto.randomUUID(), name: torName, sourceName: torName, size: null, handleKey: "tor",
    });
    for (const name of state.files?.evidenceNames ?? []) {
      entries.push({
        id: crypto.randomUUID(), name, sourceName: name, size: null, handleKey: `catalog:${name}`,
      });
    }
    const leftId = entries.find((item) => item.handleKey === "tor")?.id ?? null;
    const rightId = entries.find((item) => item.name === state.files?.activeEvidenceName)?.id
      ?? entries.find((item) => item.handleKey.startsWith("catalog:"))?.id ?? null;
    return {
      entries,
      nextTabs: {
        left: { openIds: leftId ? [leftId] : [], activeId: leftId },
        right: { openIds: rightId ? [rightId] : [], activeId: rightId },
      } satisfies WorkspaceTabs,
    };
  };

  const handleRestoreFiles = async () => {
    setIsRestoringFiles(true);
    setRestoreMessage("Restoring file access...");
    try {
      const result = await restoreFilesFromHandles(documents, tabs);
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

  const openCatalogPicker = async (target?: WorkspaceDocument, slot: Slot = activePane, replace = false) => {
    pickerSlotRef.current = slot;
    setActivePane(slot);
    reattachTargetRef.current = null;
    replaceTargetRef.current = null;
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: !target,
          types: [
            {
              description: "PDF documents",
              accept: { "application/pdf": [".pdf"] },
            },
          ],
        });
        const documents = await Promise.all(
          handles.map(async (handle) => ({
            file: await handle.getFile(),
            handle,
          })),
        );
        if (target && documents[0] && replace) void replaceDocument(target, documents[0]);
        else if (target && documents[0]) void reattachDocument(target, documents[0]);
        else void addDocuments(documents, slot);
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

    reattachTargetRef.current = target ?? null;
    replaceTargetRef.current = replace && target ? target : null;
    explorerPickerRef.current?.click();
  };

  useEffect(() => {
    let cancelled = false;
    const restoreWorkspace = async () => {
      let restored: PersistedWorkspaceState | null;
      try {
        restored = readPersistedWorkspace(workspaceId);
      } catch (error) {
        setFatalRestoreError(getErrorMessage(error));
        return;
      }
      if (!restored) {
        setHasRestoredWorkspace(true);
        return;
      }

      const restoredDocuments = restored.documents?.length || restored.version === 2
        ? {
            entries: restored.documents ?? [],
            nextTabs: restored.tabs ?? emptyWorkspaceTabs(),
          }
        : legacyDocuments(restored);
      const nextTabs = restoreReviewTableTabs(
        restoredDocuments.nextTabs,
        workspaceId,
        restored.version === 1 || restored.panel?.reviewView === "rows",
      );
      setReviewTableName(typeof restored.reviewTable?.name === "string"
        ? sanitizeWorkspaceName(restored.reviewTable.name) || "Review Table"
        : "Review Table");
      const restoredColumnCount = restored.reviewTable?.linkColumnCount;
      setLinkColumnCount(typeof restoredColumnCount === "number" && Number.isInteger(restoredColumnCount) && restoredColumnCount > 0
        ? Math.min(100, restoredColumnCount) : 1);
      setLinkColumnColors(sanitizeColumnLinkColors(restored.reviewTable?.linkColumnColors));
      setDocuments(restoredDocuments.entries);
      setTabs(nextTabs);
      setDocumentViews(restored.panel?.documentViews ?? {});

      setWorkspaceName(
        sanitizeWorkspaceName(restored.workspaceName ?? "") ||
          "Untitled workspace",
      );
      setMarks(sanitizeMarksForStorage(restored.marks ?? []).map((mark) => {
        if (mark.documentId || mark.manual) return mark;
        const entry = restoredDocuments.entries.find((item) =>
          item.name === mark.fileName &&
          (restored.version === 2 ||
            (mark.side === "tor" ? item.handleKey === "tor" : item.handleKey.startsWith("catalog:"))),
        );
        return entry ? { ...mark, documentId: entry.id, reviewRole: mark.side === "tor" ? "requirement" : undefined } : mark;
      }));
      setTextPlacements(sanitizeRequirementTextPlacements(restored.textPlacements));
      setLinks(restored.links ?? []);
      setLeftWidth(
        Math.min(80, Math.max(20, Number(restored.panel?.leftWidth) || 50)),
      );
      setExplorerWidth(Math.min(440, Math.max(240, Number(restored.panel?.explorerWidth) || 300)));
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
      const result = await restoreFilesFromHandles(
        restoredDocuments.entries,
        nextTabs,
        () => cancelled,
      );
      if (cancelled) return;
      if (result.restored < result.attempted) {
        setRestoreMessage(
          `${result.attempted - result.restored} document${result.attempted - result.restored === 1 ? " needs" : "s need"} file access. Select the PDF again in Explorer.`,
        );
      }

      setHasRestoredWorkspace(true);
    };

    void restoreWorkspace();
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!hasRestoredWorkspace) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    const savedAt = new Date().toISOString();
    const didSave = writePersistedWorkspace(workspaceId, {
      version: 2,
      savedAt,
      workspaceName: sanitizeWorkspaceName(workspaceName),
      marks: sanitizeMarksForStorage(marks),
      textPlacements: sanitizeRequirementTextPlacements(textPlacements),
      links,
      documents,
      reviewTable: { id: tableId, name: reviewTableName, kind: "review-table", linkColumnCount, linkColumnColors },
      tabs,
      panel: {
        leftWidth,
        isReviewOpen,
        isReviewPinned,
        showTorPane,
        showEvidencePane,
        reviewFilter,
        reviewView: "highlights",
        interactionMode,
        documentViews,
        explorerWidth,
      },
      catalogLabelOffset,
      collapsedRequirementIds: Array.from(collapsedRequirements),
      files: {
        torName: documents.find((item) => item.id === tabs.left.activeId)?.sourceName ?? null,
        activeEvidenceName: documents.find((item) => item.id === tabs.right.activeId)?.sourceName ?? null,
        evidenceNames: documents.map((item) => item.sourceName),
      },
    });
    if (didSave) onWorkspaceSaved(workspaceId, workspaceName, savedAt);
    else setRestoreMessage("Could not save this workspace in browser storage.");
  }, [
    catalogFiles,
    catalogLabelOffset,
    collapsedRequirements,
    documents,
    reviewTableName,
    linkColumnCount,
    linkColumnColors,
    documentViews,
    explorerWidth,
    files.left,
    files.right,
    hasRestoredWorkspace,
    interactionMode,
    isReviewOpen,
    isReviewPinned,
    showTorPane,
    showEvidencePane,
    leftWidth,
    links,
    marks,
    textPlacements,
    reviewFilter,
    tabs,
    workspaceId,
    workspaceName,
  ]);

  useEffect(() => {
    const dialog = clearDialogRef.current;
    if (!dialog) return;
    if (isClearConfirmOpen && !dialog.open) dialog.showModal();
    if (!isClearConfirmOpen && dialog.open) dialog.close();
  }, [isClearConfirmOpen]);

  useEffect(() => {
    if (!isWorkspaceMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsWorkspaceMenuOpen(false);
    };
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setIsWorkspaceMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [isWorkspaceMenuOpen]);

  useEffect(() => {
    if (!openExplorerMenuId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenExplorerMenuId(null);
    };
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-explorer-actions]")) {
        setOpenExplorerMenuId(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [openExplorerMenuId]);

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
    if (!pendingJumpId || !pendingJumpSlot) return;

    const jumpWhenReady = (event: Event) => {
      const detail = (event as CustomEvent<string | { id: string; side: "tor" | "catalog" }>).detail;
      const targetSide = pendingJumpSlot === "left" ? "tor" : "catalog";
      if (typeof detail === "string" ? detail !== pendingJumpId :
        detail.id !== pendingJumpId || detail.side !== targetSide) return;
      window.dispatchEvent(
        new CustomEvent("comparex:jump-to-mark", { detail: { id: pendingJumpId, side: targetSide } }),
      );
      setPendingJumpId(null);
      setPendingJumpSlot(null);
    };
    window.addEventListener("comparex:mark-ready", jumpWhenReady);
    return () => window.removeEventListener("comparex:mark-ready", jumpWhenReady);
  }, [pendingJumpId, pendingJumpSlot]);

  useEffect(() => {
    if (!pendingPlacementJumpId || !pendingPlacementJumpSlot) return;
    const jumpWhenReady = (event: Event) => {
      const { id, side } = (event as CustomEvent<{ id: string; side: "tor" | "catalog" }>).detail;
      if (id !== pendingPlacementJumpId || side !== (pendingPlacementJumpSlot === "left" ? "tor" : "catalog")) return;
      window.dispatchEvent(new CustomEvent("comparex:jump-to-placement", { detail: { id, side } }));
      setPendingPlacementJumpId(null);
      setPendingPlacementJumpSlot(null);
    };
    window.addEventListener("comparex:placement-ready", jumpWhenReady);
    return () => window.removeEventListener("comparex:placement-ready", jumpWhenReady);
  }, [pendingPlacementJumpId, pendingPlacementJumpSlot]);

  const openDocument = (slot: Slot, documentId: string) => {
    const item = catalogFiles.find((candidate) => candidate.id === documentId) ?? null;
    setActivePane(slot);
    setTabs((current) => openWorkspaceTab(current, slot, documentId));
    setFiles((current) => ({ ...current, [slot]: item }));
    if (!item && documentId !== tableId) setRestoreMessage("This document needs file access. Select it again in Explorer.");
  };

  const moveDocumentTab = (from: Slot, to: Slot, documentId: string) => {
    if (from === to || !tabs[from].openIds.includes(documentId)) return;
    const nextTabs = moveWorkspaceTab(tabs, from, to, documentId);
    const sourceViewKey = `${from}:${documentId}`;
    const targetViewKey = `${to}:${documentId}`;
    setTabs(nextTabs);
    setFiles((current) => ({
      ...current,
      [from]: catalogFiles.find((item) => item.id === nextTabs[from].activeId) ?? null,
      [to]: catalogFiles.find((item) => item.id === documentId) ?? null,
    }));
    setDocumentViews((current) => current[sourceViewKey] && !current[targetViewKey]
      ? { ...current, [targetViewKey]: current[sourceViewKey] }
      : current,
    );
    if (to === "left") setShowTorPane(true);
    else setShowEvidencePane(true);
    setActivePane(to);
  };

  const openReviewTable = (slot: Slot = activePane) => openDocument(slot, tableId);
  const revealReviewTable = (markId?: string) => {
    if (markId) setFocusTableMarkId(markId);
    openReviewTable(tabs.left.activeId === tableId ? "left" : tabs.right.activeId === tableId ? "right" : "right");
  };

  const updateDocumentView = (slot: Slot, documentId: string, view: DocumentView) => {
    const key = `${slot}:${documentId}`;
    setDocumentViews((current) => current[key]?.page === view.page && current[key]?.scale === view.scale
      ? current
      : { ...current, [key]: view },
    );
  };

  const closeDocumentTab = (slot: Slot, documentId: string) => {
    const nextId = closeWorkspaceTab(tabs, slot, documentId)[slot].activeId;
    setTabs((current) => closeWorkspaceTab(current, slot, documentId));
    setFiles((current) => ({
      ...current,
      [slot]: catalogFiles.find((item) => item.id === nextId) ?? null,
    }));
  };

  const addDocuments = async (selected: SelectedDocument[], slot: Slot) => {
    const accepted: Array<{ entry: WorkspaceDocument; item: UploadedFile; handle?: FileSystemFileHandle }> = [];
    let rejected = 0;
    if (selected.length) setRestoreMessage("Validating PDF documents...");
    for (const { file, handle } of selected) {
      const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
      if (!isPdfFile(file) || signature !== "%PDF-" || file.size > 100 * 1024 * 1024) {
        rejected += 1;
        continue;
      }
      let sha256: string;
      try {
        sha256 = await sha256File(file);
      } catch {
        rejected += 1;
        continue;
      }
      const id = crypto.randomUUID();
      accepted.push({
        entry: {
          id, name: file.name, sourceName: file.name, size: file.size, sha256,
          handleKey: workspaceHandleKey(workspaceId, id),
        },
        item: { id, file, url: URL.createObjectURL(file) },
        handle,
      });
    }
    setRestoreMessage(rejected
      ? `${rejected} file${rejected === 1 ? " was" : "s were"} not added. Use readable PDFs up to 100 MB.`
      : "");
    if (!accepted.length) return;
    const additions = accepted.map(({ item }) => item);
    setDocuments((current) => [...current, ...accepted.map(({ entry }) => entry)]);
    setCatalogFiles((current) => [...current, ...additions]);
    setDocumentStatuses((current) => ({
      ...current,
      ...Object.fromEntries(additions.map((item) => [item.id, { status: "opening" as const }])),
    }));
    setTabs((current) => openWorkspaceTab(current, slot, additions[0].id));
    setFiles((current) => ({ ...current, [slot]: additions[0] }));
    setActivePane(slot);
    accepted.forEach(({ entry, handle }) => {
      void saveFileHandle(entry.handleKey, entry.name, handle);
    });
  };

  const reattachDocument = async (entry: WorkspaceDocument, selected: SelectedDocument) => {
    const { file, handle } = selected;
    const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (!isPdfFile(file) || signature !== "%PDF-" || file.size > 100 * 1024 * 1024) {
      setRestoreMessage("Select a readable PDF up to 100 MB.");
      return;
    }
    let sha256: string;
    try {
      sha256 = await sha256File(file);
    } catch {
      setRestoreMessage("Could not verify this PDF. Try selecting it again.");
      return;
    }
    if (entry.sha256 && sha256 !== entry.sha256) {
      setRestoreMessage("This PDF differs from the original. Its saved highlights were not attached.");
      return;
    }
    if (!entry.sha256 && (file.name !== (entry.sourceName || entry.name) ||
      (entry.size !== null && file.size !== entry.size))) {
      setRestoreMessage("This file does not match the saved document name and size.");
      return;
    }
    if (entry.size === null && !window.confirm(
      `The original file details for “${entry.name}” were not saved. Confirm this is the same PDF before restoring its highlights.`,
    )) return;
    const previous = catalogFiles.find((item) => item.id === entry.id);
    if (previous) URL.revokeObjectURL(previous.url);
    const item = { id: entry.id, file, url: URL.createObjectURL(file) };
    setCatalogFiles((current) => [...current.filter((candidate) => candidate.id !== entry.id), item]);
    setDocumentStatuses((current) => ({ ...current, [entry.id]: { status: "opening" } }));
    setDocuments((current) => current.map((candidate) =>
      candidate.id === entry.id ? { ...candidate, size: file.size, sha256 } : candidate,
    ));
    setFiles((current) => ({
      left: tabs.left.activeId === entry.id ? item : current.left,
      right: tabs.right.activeId === entry.id ? item : current.right,
    }));
    setMarks((current) => current.map((mark) =>
      mark.documentId === entry.id ? { ...mark, fileUrl: item.url } : mark,
    ));
    if (handle) void saveFileHandle(entry.handleKey, entry.sourceName || entry.name, handle);
    else void deleteFileHandle(entry.handleKey);
    setRestoreMessage(handle
      ? `Restored access to ${entry.name}.`
      : `Opened ${entry.name} for this session. Reopen it after a reload if requested.`);
  };

  const replaceDocument = async (entry: WorkspaceDocument, selected: SelectedDocument) => {
    const { file, handle } = selected;
    const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (!isPdfFile(file) || signature !== "%PDF-" || file.size > 100 * 1024 * 1024) {
      setRestoreMessage("Select a readable PDF up to 100 MB.");
      return;
    }
    let sha256: string;
    try { sha256 = await sha256File(file); }
    catch { setRestoreMessage("Could not verify this PDF."); return; }
    if (entry.sha256 && entry.sha256 === sha256) {
      void reattachDocument(entry, selected);
      return;
    }
    if (!window.confirm(
      `Replace “${entry.name}”? Its saved highlights, links, and placed text will be removed because page locations may change.`,
    )) return;
    const removedMarkIds = new Set(marks.filter((mark) => mark.documentId === entry.id).map((mark) => mark.id));
    setMarks((current) => current.filter((mark) => mark.documentId !== entry.id));
    setTextPlacements((current) => current.filter((placement) => placement.documentId !== entry.id));
    setLinks((current) => removeWorkspaceLinksForItems(current, removedMarkIds));
    if (pendingLinkSourceId && removedMarkIds.has(pendingLinkSourceId)) setPendingLinkSourceId(null);
    const previous = catalogFiles.find((item) => item.id === entry.id);
    if (previous) URL.revokeObjectURL(previous.url);
    const item = { id: entry.id, file, url: URL.createObjectURL(file) };
    setCatalogFiles((current) => [...current.filter((candidate) => candidate.id !== entry.id), item]);
    setDocuments((current) => current.map((candidate) => candidate.id === entry.id
      ? { ...candidate, name: file.name, sourceName: file.name, size: file.size, sha256, pageCount: undefined }
      : candidate,
    ));
    setDocumentStatuses((current) => ({ ...current, [entry.id]: { status: "opening" } }));
    setFiles((current) => ({
      left: tabs.left.activeId === entry.id ? item : current.left,
      right: tabs.right.activeId === entry.id ? item : current.right,
    }));
    if (handle) void saveFileHandle(entry.handleKey, file.name, handle);
    else void deleteFileHandle(entry.handleKey);
    setRestoreMessage(handle
      ? `Replaced ${entry.name}. Its previous highlights were removed.`
      : `Replaced ${entry.name} for this session. Reopen the PDF after a reload if requested.`);
  };

  const selectForWorkspaceLink = (itemId: string) => {
    if (pendingLinkSourceId && pendingLinkSourceId !== itemId) {
      const row = gridRows.find((candidate) => candidate.kind === "requirement" &&
        (candidate.mark.id === pendingLinkSourceId || candidate.mark.id === itemId));
      if (row) linkRowHighlight(row.mark.id, row.mark.id === itemId ? pendingLinkSourceId : itemId);
      else setLinks((current) => addWorkspaceLink(current, pendingLinkSourceId, itemId, () => crypto.randomUUID()));
      setPendingLinkSourceId(null);
      setInteractionMode("highlight");
    } else {
      setPendingLinkSourceId(itemId);
      setInteractionMode("link");
      setIsReviewOpen(true);
    }
  };

  const removeDocument = (entry: WorkspaceDocument) => {
    if (!window.confirm(`Remove “${entry.name}”, its highlights, and placed text from this workspace?`)) return;
    const loaded = catalogFiles.find((item) => item.id === entry.id);
    if (loaded) URL.revokeObjectURL(loaded.url);
    setDocuments((current) => current.filter((item) => item.id !== entry.id));
    setDocumentViews((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.endsWith(`:${entry.id}`))));
    setCatalogFiles((current) => current.filter((item) => item.id !== entry.id));
    setDocumentStatuses((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setMarks((current) => current.filter((mark) => mark.documentId !== entry.id));
    setTextPlacements((current) => current.filter((placement) => placement.documentId !== entry.id));
    const removedMarkIds = new Set(marks.filter((mark) => mark.documentId === entry.id).map((mark) => mark.id));
    if (pendingLinkSourceId && removedMarkIds.has(pendingLinkSourceId)) setPendingLinkSourceId(null);
    setLinks((current) => removeWorkspaceLinksForItems(current, removedMarkIds));
    const nextTabs = removeWorkspaceDocumentTabs(tabs, entry.id);
    setTabs(nextTabs);
    setFiles({
      left: catalogFiles.find((item) => item.id === nextTabs.left.activeId && item.id !== entry.id) ?? null,
      right: catalogFiles.find((item) => item.id === nextTabs.right.activeId && item.id !== entry.id) ?? null,
    });
    void deleteFileHandle(entry.handleKey);
  };

  const createEvidenceMark = (
    mark: EvidenceMark,
    intent: "highlight" | "link",
  ) => {
    const sourceFile = catalogFiles.find((item) => item.url === mark.fileUrl);
    const sourcedMark: EvidenceMark = {
      ...mark,
      documentId: sourceFile?.id,
      reviewRole: "highlight",
      linkId: undefined,
    };
    const markWithLabelDefault =
      mark.side === "catalog" && catalogLabelOffset
        ? { ...sourcedMark, labelOffset: catalogLabelOffset }
        : sourcedMark;
    setMarks((current) => [...current, markWithLabelDefault]);
    if (
      intent === "highlight" &&
      interactionMode === "highlight" &&
      activeEvidenceRowId &&
      (tabs.left.activeId === tableId || tabs.right.activeId === tableId) &&
      marks.some((item) => item.id === activeEvidenceRowId && item.reviewRole !== "highlight" && !item.referenceOnly)
    ) {
      linkRowHighlight(activeEvidenceRowId, mark.id, activeLinkColumn ?? undefined);
      if (autoAdvanceEvidence) {
        const nextId = nextRequirementRowId(gridRows, activeEvidenceRowId);
        if (nextId) {
          const nextRow = gridRows.find((row) => row.kind === "requirement" && row.mark.id === nextId);
          const nextColumn = nextAvailableLinkColumn(nextRow?.links ?? [], activeLinkColumn ?? undefined);
          setLinkColumnCount((current) => Math.max(current, nextColumn));
          setActiveLinkColumn(nextColumn);
          setActiveEvidenceRowId(nextId);
          setFocusEvidenceMarkId(nextId);
          setAutoAdvanceNotice("");
        } else {
          setAutoAdvanceEvidence(false);
          setAutoAdvanceNotice("Last requirement reached. Auto next stopped.");
          setActiveEvidenceRowId(null);
          setActiveLinkColumn(null);
        }
      } else {
        setActiveEvidenceRowId(null);
        setActiveLinkColumn(null);
      }
    }
    if (intent === "link") {
      if (pendingLinkSourceId && pendingLinkSourceId !== mark.id) {
        const row = gridRows.find((candidate) => candidate.kind === "requirement" && candidate.mark.id === pendingLinkSourceId);
        if (row) linkRowHighlight(row.mark.id, mark.id);
        else setLinks((current) => addWorkspaceLink(current, pendingLinkSourceId, mark.id, () => crypto.randomUUID()));
        setPendingLinkSourceId(null);
        setInteractionMode("highlight");
      } else {
        setPendingLinkSourceId(mark.id);
        setInteractionMode("link");
      }
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
    setLinks((current) => removeWorkspaceLinksForItems(current, new Set([mark.id])));
    setTextPlacements((current) => current.filter((placement) => placement.rowId !== mark.id));
    if (pendingLinkSourceId === mark.id) setPendingLinkSourceId(null);
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
    const placedCount = textPlacements.filter((placement) => ids.has(placement.rowId)).length;
    if (
      !window.confirm(
        `Remove ${requirements.length} selected ${label}? Supporting evidence will remain unassigned.${placedCount ? ` ${placedCount} placed text annotation${placedCount === 1 ? "" : "s"} will also be removed.` : ""}`,
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
    setLinks((current) => removeWorkspaceLinksForItems(current, ids));
    setTextPlacements((current) => current.filter((placement) => !ids.has(placement.rowId)));
    if (pendingLinkSourceId && ids.has(pendingLinkSourceId)) setPendingLinkSourceId(null);
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
    setMarks((current) => [
      ...current,
      ...items.map((item) => ({
          id: crypto.randomUUID(),
          side: "tor" as const,
          fileName: "Manual requirement",
          page: 0,
          text: item.title,
          manual: true,
          requirementNo: item.number || undefined,
        })),
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
    setMarks((current) =>
      current.map((item) =>
        item.id === mark.id
          ? { ...item, requirementNo: requirementNo.trim() }
          : item,
      ),
    );
  };

  const moveRequirementRows = (sourceIds: string[], targetId: string, edge: "before" | "after") => {
    setMarks((current) => moveTableRows(current, sourceIds, targetId, (item) =>
      item.side === "tor" && item.reviewRole !== "highlight" && !item.referenceOnly,
      edge,
    ));
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

  const unlinkEvidenceMark = (mark: EvidenceMark, requirement?: EvidenceMark) => {
    if (requirement) {
      setLinks((current) => removeWorkspaceLinkBetween(current, requirement.id, mark.id));
      if (!mark.linkId || mark.linkId !== requirement.linkId) return;
    }
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
      (mark) => mark.id === evidenceId && !mark.manual && mark.id !== torMark.id,
    );
    if (!evidenceMark) return;
    linkRowHighlight(torMark.id, evidenceMark.id);
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
    const targetFile = catalogFiles.find(
      (item) =>
        (mark.documentId && item.id === mark.documentId) ||
        (mark.fileUrl && item.url === mark.fileUrl) ||
        item.file.name === mark.fileName,
    );
    const tableSlot: Slot | null = tabs.left.activeId === tableId
      ? "left"
      : tabs.right.activeId === tableId ? "right" : null;
    const slot: Slot = tableSlot === "left" ? "right" : tableSlot === "right" ? "left" :
      mark.side === "tor" ? "left" : "right";
    if (!targetFile) {
      setRestoreMessage(`Select ${mark.fileName} again to open this highlight.`);
      return;
    }
    if (files[slot]?.id === targetFile.id) {
      window.dispatchEvent(
        new CustomEvent("comparex:jump-to-mark", { detail: { id: mark.id, side: slot === "left" ? "tor" : "catalog" } }),
      );
      return;
    }

    setPendingJumpId(mark.id);
    setPendingJumpSlot(slot);
    openDocument(slot, targetFile.id);
  };

  const jumpToPlacedText = (placement: RequirementTextPlacement) => {
    const targetFile = catalogFiles.find((item) => item.id === placement.documentId);
    const tableSlot: Slot | null = tabs.left.activeId === tableId
      ? "left" : tabs.right.activeId === tableId ? "right" : null;
    const slot: Slot = tableSlot === "left" ? "right" : tableSlot === "right" ? "left" : activePane;
    if (!targetFile) {
      const fileName = documents.find((item) => item.id === placement.documentId)?.name ?? "this PDF";
      setRestoreMessage(`Select ${fileName} again to open this placed text.`);
      return;
    }
    if (slot === "left") setShowTorPane(true);
    else setShowEvidencePane(true);
    const side = slot === "left" ? "tor" : "catalog";
    const paneVisible = slot === "left" ? showTorPane : showEvidencePane;
    if (files[slot]?.id === targetFile.id && paneVisible) {
      window.dispatchEvent(new CustomEvent("comparex:jump-to-placement", { detail: { id: placement.id, side } }));
      return;
    }
    setPendingPlacementJumpId(placement.id);
    setPendingPlacementJumpSlot(slot);
    openDocument(slot, targetFile.id);
  };

  const linkGroups = marks.reduce((groups, mark) => {
      if (!mark.linkId) return groups;
      groups.set(mark.linkId, (groups.get(mark.linkId) ?? 0) + 1);
      return groups;
    }, new Map<string, number>());
  const pairedLinkIds = new Set(
    Array.from(linkGroups).filter(([, count]) => count > 1).map(([id]) => id),
  );
  const allHighlights = marks.filter((mark) => !mark.manual && !mark.referenceOnly);
  const highlightCount = allHighlights.length;
  const isMarkLinked = (mark: EvidenceMark) =>
    Boolean(mark.linkId && pairedLinkIds.has(mark.linkId)) ||
    links.some((link) => link.sourceId === mark.id || link.targetId === mark.id);
  const linkedCount = allHighlights.filter(isMarkLinked).length;
  const torMarks = marks.filter(
    (mark) => mark.side === "tor" && mark.reviewRole !== "highlight" && !mark.referenceOnly,
  );
  const tableRowIds = new Set(torMarks.map((mark) => mark.id));
  const colorsByMarkId = useMemo(() => colorsByTableColumns(
    marks,
    marks.filter((mark) => mark.side === "tor" && mark.reviewRole !== "highlight" && !mark.referenceOnly),
    links,
    linkColumnColors,
  ), [links, linkColumnColors, marks]);
  const unlinkedCatalogMarks = unassignedTableHighlights(allHighlights, tableRowIds, pairedLinkIds, links);
  const unlinkedCount = highlightCount - linkedCount;
  const visibleTorMarks = torMarks;
  const visibleTorIds = new Set(visibleTorMarks.map((mark) => mark.id));
  const allRequirementRows = torMarks.map((mark) => ({
    mark,
    path: mark.requirementNo?.trim() ?? "",
  }));
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
  for (const { mark } of allRequirementRows) {
    if (!mark.linkId) continue;
    const requirementNo = mark.requirementNo?.trim() ?? "";
    const rootRequirement = getRootRequirementRow(mark);
    const rootRequirementNo =
      rootRequirement?.mark.requirementNo?.trim();

    requirementNumberByLinkId.set(mark.linkId, requirementNo);
    if (rootRequirementNo && rootRequirement) {
      rootRequirementDetailsByLinkId.set(mark.linkId, {
        requirementNo: rootRequirementNo,
        text: rootRequirement.mark.text.trim(),
      });
    }
  }
  const requirementNumbersByMarkId = useMemo(() => requirementNumbersByEvidenceMark(
    marks,
    allRequirementRows.map(({ mark }) => ({
      mark,
      number: mark.requirementNo?.trim() ?? "",
    })),
    links,
  ), [marks, links]);
  const textPlacementsByRow = useMemo(() => {
    const grouped = new Map<string, RequirementTextPlacement[]>();
    for (const placement of textPlacements) {
      const rowPlacements = grouped.get(placement.rowId) ?? [];
      rowPlacements.push(placement);
      grouped.set(placement.rowId, rowPlacements);
    }
    return grouped;
  }, [textPlacements]);
  const placedTextCountByRow = useMemo(() => new Map(
    Array.from(textPlacementsByRow, ([rowId, placements]) => [rowId, placements.length]),
  ), [textPlacementsByRow]);
  const gridRows: RequirementGridRow[] = [
    ...requirementRows.map(({ mark, path }) => ({
      kind: "requirement" as const,
      mark,
      path,
      links: tableLinkSlotsForRow(marks, mark, links).map(({ mark: linkedMark, column }) => ({
        mark: linkedMark,
        column,
        color: columnLinkColor(linkColumnColors, column),
      })),
    })),
    ...unlinkedCatalogMarks.map((mark) => ({
      kind: "unassigned" as const,
      mark,
      path: "" as const,
      links: [{ mark, color: columnLinkColor(linkColumnColors, 1), column: 1 }],
    })),
  ];
  const linkRowHighlight = (rowId: string, markId: string, preferredColumn?: number) => {
    const row = gridRows.find((candidate) => candidate.kind === "requirement" && candidate.mark.id === rowId);
    const existingColumn = row?.links.find((link) => link.mark.id === markId)?.column;
    const availableLinks = row?.links.filter((link) => link.mark.id !== markId) ?? [];
    const column = preferredColumn === undefined && existingColumn
      ? existingColumn
      : nextAvailableLinkColumn(availableLinks, preferredColumn);
    setLinkColumnCount((current) => Math.max(current, column));
    setLinks((current) => addWorkspaceLink(current, rowId, markId, () => crypto.randomUUID(), column));
    return column;
  };
  const activeEvidenceRow = gridRows.find((row) =>
    row.kind === "requirement" && row.mark.id === activeEvidenceRowId,
  );
  const activeTextRow = interactionMode === "highlight" ? gridRows.find((row) =>
    row.kind === "requirement" && row.mark.id === activeTextRowId,
  ) : undefined;
  const placeRequirementText = (documentId: string, page: number, x: number, y: number) => {
    if (!activeTextRow || !activeTextRow.mark.text.trim()) return false;
    if (activeTextRow.mark.text.length > 2000) {
      window.alert("Requirement text is too long to place on a PDF page.");
      return false;
    }
    setTextPlacements((current) => [...current, {
      id: crypto.randomUUID(),
      rowId: activeTextRow.mark.id,
      documentId,
      page,
      x,
      y,
      text: activeTextRow.mark.text,
    }]);
    setPlacedTextMenu(null);
    setActiveTextRowId(null);
    return true;
  };
  const directEvidenceTargetId = interactionMode === "highlight" && activeEvidenceRow &&
    (tabs.left.activeId === tableId || tabs.right.activeId === tableId)
    ? activeEvidenceRow.mark.id
    : null;
  const selectedPlacedRow = placedTextMenu
    ? gridRows.find((row) => row.kind === "requirement" && row.mark.id === placedTextMenu.rowId)
    : undefined;
  const selectedRowPlacements = placedTextMenu ? textPlacementsByRow.get(placedTextMenu.rowId) ?? [] : [];

  useEffect(() => {
    if (!placedTextMenu) return;
    placedTextMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const closeOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (!placedTextMenuRef.current?.contains(event.target as Node)) setPlacedTextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlacedTextMenu(null);
        placedTextReturnFocusRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [placedTextMenu]);

  const getPrintableEvidenceAnnotations = (evidenceFile: UploadedFile) =>
    marks.flatMap<PdfAnnotation>((mark) => {
      if (
        mark.manual ||
        (mark.documentId && mark.documentId !== evidenceFile.id) ||
        (!mark.documentId && mark.fileName !== evidenceFile.file.name)
      ) {
        return [];
      }
      const anchor = mark.annotation ??
        (mark.area ? { x: mark.area.x, y: mark.area.y } : undefined);
      return anchor
        ? [{
            mark,
            anchor,
            requirementNo: requirementNumbersByMarkId.get(mark.id)?.join(" · #"),
            colors: colorsByMarkId.get(mark.id) ?? [resolveLinkColor(mark.color)],
          }]
        : [];
    });
  const getPrintableTextPlacements = (evidenceFile: UploadedFile) =>
    textPlacements.filter((placement) => placement.documentId === evidenceFile.id);

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

  const downloadAnnotatedEvidence = async (evidenceFile: UploadedFile | null) => {
    if (!evidenceFile || !isPdfFile(evidenceFile.file)) return;

    const annotations = getPrintableEvidenceAnnotations(evidenceFile);
    const printableText = getPrintableTextPlacements(evidenceFile);
    if (!annotations.length && !printableText.length) {
      window.alert("No highlights or placed text to download.");
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
        printableText,
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
      window.alert("No loaded PDFs have downloadable highlights.");
      return;
    }

    const outputTitle = getWorkspaceOutputTitle("Annotated PDFs");

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
              getPrintableTextPlacements(item),
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
    const handlesCleared = await clearFileHandles(documents.map((item) => item.handleKey));
    const workspaceCleared = handlesCleared && clearPersistedWorkspace(workspaceId);
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
    setDocumentStatuses({});
    setDocuments([]);
    setReviewTableName("Review Table");
    setLinkColumnCount(1);
    setLinkColumnColors({});
    setTabs(initialWorkspaceTabs(workspaceId));
    setDocumentViews({});
    setExplorerWidth(300);
    setOpenExplorerMenuId(null);
    setMarks([]);
    setTextPlacements([]);
    setActiveTextRowId(null);
    setPlacedTextMenu(null);
    setLinks([]);
    setPendingLinkSourceId(null);
    setWorkspaceName("Untitled workspace");
    setLeftWidth(50);
    setIsResizing(false);
    setCatalogLabelOffset(null);
    setPendingLinkId(null);
    setIsReviewOpen(false);
    setIsReviewPinned(false);
    setShowTorPane(true);
    setShowEvidencePane(true);
    setReviewFilter("all");
    setDragOverTorId(null);
    setPendingJumpId(null);
    setPendingPlacementJumpId(null);
    setPendingPlacementJumpSlot(null);
    setFocusTableMarkId(null);
    setActiveEvidenceRowId(null);
    setActiveLinkColumn(null);
    setInteractionMode("highlight");
    setCollapsedRequirements(new Set());
    setRequirementComposer(null);
    setRestoreMessage("Workspace cleared. Original files remain on your device.");
    onWorkspaceSaved(workspaceId, "Untitled workspace", new Date().toISOString());
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

  const downloadableCatalogFiles = catalogFiles.filter((item) =>
    isPdfFile(item.file) && (getPrintableEvidenceAnnotations(item).length > 0 || getPrintableTextPlacements(item).length > 0),
  );
  const visibleDocumentPaneCount = Number(showTorPane) + Number(showEvidencePane);
  const isReviewTableVisible = (showTorPane && tabs.left.activeId === tableId) ||
    (showEvidencePane && tabs.right.activeId === tableId);
  const workspaceVisibilityClass =
    visibleDocumentPaneCount === 0
      ? "no-document-panes"
      : visibleDocumentPaneCount === 1
        ? "one-pane"
        : "";

  const reviewTable: ReviewTableItem = { id: tableId, name: reviewTableName, kind: "review-table" };
  const editorItems: EditorItem[] = [reviewTable, ...documents.map((item) => ({
    id: item.id,
    name: item.name,
    kind: "pdf" as const,
  }))];
  const openPaneLabels = (id: string) =>
    [tabs.left.activeId === id ? paneLabel("left") : null, tabs.right.activeId === id ? paneLabel("right") : null]
      .filter(Boolean).join(" and ") || "no pane";

  const renderReviewTable = (slot: Slot) => (
    <section
      className="review-table-editor"
      aria-label={`${reviewTableName} in ${paneLabel(slot)}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKSPACE_TAB_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        const tab = readDraggedWorkspaceTab(event);
        if (!tab) return;
        event.preventDefault();
        moveDocumentTab(tab.from, slot, tab.id);
      }}
    >
      <EditorTabs
        slot={slot}
        pane={tabs[slot]}
        documents={editorItems}
        onOpen={(id) => openDocument(slot, id)}
        onClose={(id) => closeDocumentTab(slot, id)}
        onMove={(from, id) => moveDocumentTab(from, slot, id)}
        onAdd={() => void openCatalogPicker(undefined, slot)}
        onDownload={() => undefined}
      />
      <div className="review-table-body">
        <RequirementGrid
          rows={gridRows}
          linkColumnCount={linkColumnCount}
          linkColumnColors={linkColumnColors}
          onAddLinkColumn={() => setLinkColumnCount((current) => Math.min(100, current + 1))}
          onChangeColumnColor={(column, color) => setLinkColumnColors((current) => ({ ...current, [column]: color }))}
          showStartHint={!torMarks.length}
          focusMarkId={focusTableMarkId}
          onFocusHandled={() => setFocusTableMarkId(null)}
          focusEvidenceMarkId={focusEvidenceMarkId}
          onEvidenceFocusHandled={() => setFocusEvidenceMarkId(null)}
          onJump={(mark) => { setPlacedTextMenu(null); jumpToEvidenceMark(mark); }}
          onDropEvidence={linkDroppedEvidence}
          onAddRequirement={(title) => createManualRequirement(title)}
          onAddRequirements={createManualRequirements}
          onRenameRequirement={renameRequirement}
          onRenameRequirementNo={renameRequirementNo}
          onMoveRequirements={moveRequirementRows}
          isLinkMode={interactionMode === "link"}
          onSelectForLink={(mark) => selectForWorkspaceLink(mark.id)}
          activeLinkRowId={activeEvidenceRowId}
          activeLinkColumn={activeLinkColumn}
          onEvidenceTargetChange={(mark, column) => {
            if (mark) setPlacedTextMenu(null);
            const nextId = mark?.id ?? null;
            if (focusEvidenceMarkId && nextId !== focusEvidenceMarkId) return;
            if (nextId !== activeEvidenceRowId) setAutoAdvanceNotice("");
            if (mark && (nextId !== activeEvidenceRowId || (column ?? 1) !== activeLinkColumn)) {
              setAutoAdvanceEvidence(true);
            }
            setActiveEvidenceRowId(nextId);
            setActiveLinkColumn(mark ? column ?? 1 : null);
            if (!mark) setAutoAdvanceEvidence(false);
          }}
          onRequirementTargetChange={(mark) => {
            setActiveTextRowId(mark?.id ?? null);
            if (mark) setPlacedTextMenu(null);
          }}
          placedTextCountByRow={placedTextCountByRow}
          onJumpToPlacedText={(rowId) => {
            const placement = latestRequirementTextPlacement(textPlacements, rowId);
            if (!placement) return;
            setActiveTextRowId(null);
            setPlacedTextMenu(null);
            jumpToPlacedText(placement);
          }}
          onOpenPlacedTextMenu={(rowId, bounds) => {
            placedTextReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setPlacedTextMenu({
              rowId,
              left: Math.max(8, Math.min(window.innerWidth - 340, bounds.x)),
              top: Math.max(8, Math.min(window.innerHeight - 280, bounds.y + bounds.height + 4)),
            });
          }}
          onDeletePlacedText={(rowIds) => {
            setTextPlacements((current) => removeRequirementTextPlacements(current, rowIds));
            if (placedTextMenu && rowIds.includes(placedTextMenu.rowId)) setPlacedTextMenu(null);
          }}
          onDeleteRequirements={removeRequirements}
          onRemoveHighlight={removeEvidenceMark}
        />
        {placedTextMenu && selectedPlacedRow && selectedRowPlacements.length ? (
          <div
            ref={placedTextMenuRef}
            className="placed-text-menu"
            role="group"
            aria-label={`Placed text for ${selectedPlacedRow.path ? `No. ${selectedPlacedRow.path}` : "selected row"}`}
            style={{ left: placedTextMenu.left, top: placedTextMenu.top }}
          >
            <strong>Placed text for {selectedPlacedRow.path ? `No. ${selectedPlacedRow.path}` : "selected row"}</strong>
            <div className="placed-text-location-list">
              {selectedRowPlacements.map((placement, index) => (
                <div className="placed-text-location" key={placement.id}>
                  <button type="button" onClick={() => {
                    setPlacedTextMenu(null);
                    jumpToPlacedText(placement);
                  }}>
                    {documents.find((item) => item.id === placement.documentId)?.name ?? "Unavailable PDF"} · p.{placement.page}{selectedRowPlacements.length > 1 ? ` · copy ${index + 1}` : ""}
                  </button>
                  <button type="button" onClick={() => {
                    setTextPlacements((current) => current.filter((item) => item.id !== placement.id));
                    if (selectedRowPlacements.length === 1) setPlacedTextMenu(null);
                  }} aria-label={`Remove placed text copy ${index + 1} from page ${placement.page}`}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => {
              setPlacedTextMenu(null);
              setActiveTextRowId(selectedPlacedRow.mark.id);
            }}>Place another copy</button>
          </div>
        ) : null}
      </div>
    </section>
  );

  if (fatalRestoreError) {
    return <main className="workspace-start">
      <section className="workspace-start-content" role="alert">
        <h1>Could not open this workspace</h1>
        <p>{fatalRestoreError}</p>
        <button type="button" onClick={onCloseWorkspace}>Back to Workspaces</button>
      </section>
    </main>;
  }

  return (
    <main className={`app-shell ${isReviewPinned ? "review-pinned" : ""}`}>
      <header className="topbar">
        <button
          type="button"
          className="toolbar-brand"
          onClick={onCloseWorkspace}
          aria-label="Back to Workspaces"
          title="Back to Workspaces"
        >
          <Image
            src={comparexLogo}
            alt=""
            width={158}
            priority
          />
        </button>

        <button
          className="explorer-toggle"
          type="button"
          onClick={() => setIsExplorerOpen((current) => !current)}
          aria-expanded={isExplorerOpen}
          aria-controls="workspace-explorer"
          title={isExplorerOpen ? "Hide Explorer" : "Show Explorer"}
        >
          <FilesIcon size={17} aria-hidden="true" />
        </button>

        <div className="workspace-switcher" ref={workspaceMenuRef}>
          {isRenamingWorkspace ? (
            <input
              autoFocus
              aria-label="Workspace name"
              value={workspaceName}
              maxLength={80}
              onChange={(event) => setWorkspaceName(event.target.value)}
              onBlur={() => {
                setWorkspaceName((current) => sanitizeWorkspaceName(current) || "Untitled workspace");
                setIsRenamingWorkspace(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setWorkspaceName(renameOriginalRef.current);
                  setIsRenamingWorkspace(false);
                }
              }}
            />
          ) : (
          <button
            type="button"
            className="workspace-switcher-button"
            onClick={() => setIsWorkspaceMenuOpen((current) => !current)}
            aria-expanded={isWorkspaceMenuOpen}
            aria-controls="workspace-menu"
          >
            <span>{workspaceName}</span><ChevronDown size={14} aria-hidden="true" />
          </button>
          )}
          {isWorkspaceMenuOpen ? (
            <div id="workspace-menu" className="workspace-menu">
              <button type="button" onClick={() => { setIsWorkspaceMenuOpen(false); onCloseWorkspace(); }}>Workspaces</button>
              <button type="button" onClick={() => { setIsWorkspaceMenuOpen(false); onNewWorkspace(); }}>New Workspace...</button>
              <button type="button" onClick={() => { renameOriginalRef.current = workspaceName; setIsWorkspaceMenuOpen(false); setIsRenamingWorkspace(true); }}>Rename Workspace...</button>
              <div className="workspace-menu-heading">OPEN RECENT</div>
              {[...workspaces].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map((item) => (
                <button type="button" key={item.id} onClick={() => { setIsWorkspaceMenuOpen(false); onOpenWorkspace(item.id); }}>
                  {item.name}{item.id === workspaceId ? " · Current" : ""}
                </button>
              ))}
              <div className="workspace-menu-divider" />
              <button type="button" onClick={() => { setIsWorkspaceMenuOpen(false); onDeleteWorkspace(workspaceId); }}>Delete this Workspace...</button>
            </div>
          ) : null}
        </div>

        <nav className="toolbar-actions" aria-label="Workspace tools">
          <div className="interaction-mode" role="group" aria-label="Highlight interaction mode">
            <button
              type="button"
              className={interactionMode === "highlight" ? "active" : ""}
              onClick={() => {
                setInteractionMode("highlight");
                setPendingLinkId(null);
                setPendingLinkSourceId(null);
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
              onClick={() => {
                setActiveEvidenceRowId(null);
                setAutoAdvanceEvidence(false);
                setAutoAdvanceNotice("");
                setInteractionMode("link");
              }}
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
            className={`tool-button pane-toggle ${showTorPane ? "active-tool" : ""}`}
            type="button"
            onClick={() => setShowTorPane((current) => !current)}
            aria-pressed={showTorPane}
            aria-controls="tor-panel"
            aria-label={showTorPane ? "Hide left pane" : "Show left pane"}
            title={showTorPane ? "Hide left pane" : "Show left pane"}
          >
            <PanelLeft aria-hidden="true" size={17} />
          </button>
          <button
            className={`tool-button pane-toggle ${showEvidencePane ? "active-tool" : ""}`}
            type="button"
            onClick={() => setShowEvidencePane((current) => !current)}
            aria-pressed={showEvidencePane}
            aria-controls="evidence-panel"
            aria-label={showEvidencePane ? "Hide right pane" : "Show right pane"}
            title={showEvidencePane ? "Hide right pane" : "Show right pane"}
          >
            <PanelRight aria-hidden="true" size={17} />
          </button>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            className="tool-button"
            type="button"
            onClick={() => void downloadAllAnnotatedEvidence()}
            disabled={isDownloadingEvidence || !downloadableCatalogFiles.length}
            aria-label="Download all annotated PDFs"
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

        {isReviewTableVisible ? (
          <div className="review-table-topbar" role="group" aria-label="Review Table tools">
            {activeTextRow ? (
              <span
                className="review-table-topbar-status"
                role="status"
                aria-label={`Placing Requirement text from ${activeTextRow.path ? `No. ${activeTextRow.path}` : "selected row"}. Click the PDF page to place a copy. Later row edits will not update it; the exported copy is visible but not searchable.`}
                title="Click the PDF page to place a copy. Later row edits will not update it; the exported copy is visible but not searchable."
              >
                Text · {activeTextRow.path || "selected row"} → PDF
              </span>
            ) : activeEvidenceRow ? (
              <span
                className="review-table-topbar-status"
                role="status"
                aria-label={`Adding Link ${activeLinkColumn ?? 1} to ${activeEvidenceRow.path ? `No. ${activeEvidenceRow.path}` : "selected row"}. Select text or drag an area in the PDF to highlight and link it automatically.`}
                title="Select text or drag an area in the PDF to highlight and link it automatically."
              >
                Link {activeLinkColumn ?? 1} · {activeEvidenceRow.path || "selected row"} → PDF
              </span>
            ) : autoAdvanceNotice ? (
              <span className="review-table-topbar-status" role="status">{autoAdvanceNotice}</span>
            ) : null}
            {activeTextRow ? <button type="button" onClick={() => setActiveTextRowId(null)}>Cancel</button> : null}
            {!activeTextRow && activeEvidenceRow ? (
              <>
                <button
                  type="button"
                  className={autoAdvanceEvidence ? "auto-next-toggle active" : "auto-next-toggle"}
                  aria-pressed={autoAdvanceEvidence}
                  onClick={() => {
                    setAutoAdvanceEvidence((current) => !current);
                    setAutoAdvanceNotice("");
                  }}
                >
                  Auto next {autoAdvanceEvidence ? "On" : "Off"}
                </button>
                <button type="button" onClick={() => {
                  setFocusTableMarkId(activeEvidenceRow.mark.id);
                  setActiveEvidenceRowId(null);
                  setActiveLinkColumn(null);
                  setAutoAdvanceEvidence(false);
                  setAutoAdvanceNotice("");
                }}>Cancel</button>
              </>
            ) : null}
            <button type="button" className="review-table-add-row" onClick={() => setRequirementComposer({ parentId: null, value: "" })} aria-label="Add Review Table row" title="Add row">
              <Plus size={14} aria-hidden="true" /><span>Add row</span>
            </button>
            {requirementComposer?.parentId === null ? (
              <div className="review-table-topbar-composer">{renderRequirementComposer(null)}</div>
            ) : null}
          </div>
        ) : null}

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
          {documents.some((entry) => !catalogFiles.some((item) => item.id === entry.id)) ? (
            <button className="restore-access-button" type="button" onClick={() => void handleRestoreFiles()} disabled={isRestoringFiles}>
              {isRestoringFiles ? "Restoring..." : "Retry access"}
            </button>
          ) : null}
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
          This clears the current workspace’s PDFs, Review Table rows, highlights,
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

      <div
        ref={workbenchBodyRef}
        className={`workbench-body ${isResizingExplorer ? "resizing-explorer" : ""}`}
        style={{ "--explorer-width": `${explorerWidth}px` } as React.CSSProperties}
      >
      {isExplorerOpen ? (
        <aside id="workspace-explorer" className="workspace-explorer" aria-label="Workspace Explorer">
          <div className="explorer-heading">
            <strong>EXPLORER</strong>
            <button className="explorer-add" type="button" onClick={() => void openCatalogPicker()} aria-label="Add PDF documents" title="Add PDF documents">
              <Plus size={15} aria-hidden="true" /><span>Add PDF</span>
            </button>
          </div>
          <div className="explorer-section-title">DOCUMENTS <span>{documents.length + 1}</span></div>
          <div
            className="explorer-document-list"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void getDroppedDocuments(event).then((selected) => addDocuments(selected, activePane));
            }}
          >
            <div
              className={`explorer-document review-table-item ${tabs[activePane].activeId === tableId ? "active" : ""}`}
              draggable={renamingDocumentId !== tableId && openExplorerMenuId !== tableId}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-comparex-document", tableId);
              }}
            >
              <div className="explorer-document-row">
                {renamingDocumentId === tableId ? (
                  <input
                    autoFocus
                    value={renamingDocumentValue}
                    aria-label="Rename Review Table"
                    onChange={(event) => setRenamingDocumentValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        cancelDocumentRenameRef.current = true;
                        setRenamingDocumentId(null);
                      }
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    onBlur={() => {
                      if (!cancelDocumentRenameRef.current) {
                        setReviewTableName(sanitizeWorkspaceName(renamingDocumentValue) || reviewTableName);
                      }
                      cancelDocumentRenameRef.current = false;
                      setRenamingDocumentId(null);
                    }}
                  />
                ) : (
                  <button type="button" className="explorer-document-main" onClick={() => openReviewTable()} title={`Open ${reviewTableName} in ${paneLabel(activePane)}`} aria-label={`Open ${reviewTableName} in ${paneLabel(activePane)}. Currently open in ${openPaneLabels(tableId)}.`}>
                    <Table2 size={17} aria-hidden="true" />
                    <span><strong>{reviewTableName}</strong><small>Table · {torMarks.length} rows</small></span>
                  </button>
                )}
                <button
                  data-explorer-actions
                  type="button"
                  className="explorer-more"
                  aria-label={`More actions for ${reviewTableName}`}
                  aria-expanded={openExplorerMenuId === tableId}
                  onClick={() => setOpenExplorerMenuId((current) => current === tableId ? null : tableId)}
                ><MoreHorizontal size={17} aria-hidden="true" /></button>
              </div>
              {openExplorerMenuId === tableId ? <div data-explorer-actions className="explorer-document-menu" aria-label={`Actions for ${reviewTableName}`}>
                <button type="button" onClick={() => { openReviewTable(activePane === "left" ? "right" : "left"); setOpenExplorerMenuId(null); }}>Open in other pane</button>
                <button type="button" onClick={() => { cancelDocumentRenameRef.current = false; setRenamingDocumentId(tableId); setRenamingDocumentValue(reviewTableName); setOpenExplorerMenuId(null); }}>Rename</button>
              </div> : null}
            </div>
            {documents.map((entry, index) => {
              const loaded = catalogFiles.find((item) => item.id === entry.id);
              const status = documentStatuses[entry.id];
              return (
                <div
                  className={`explorer-document ${tabs[activePane].activeId === entry.id ? "active" : ""}`}
                  key={entry.id}
                  draggable={renamingDocumentId !== entry.id && openExplorerMenuId !== entry.id}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-comparex-document", entry.id);
                  }}
                >
                  <div className="explorer-document-row">
                    {renamingDocumentId === entry.id ? (
                      <input
                        autoFocus
                        value={renamingDocumentValue}
                        aria-label={`Rename ${entry.name}`}
                        onChange={(event) => setRenamingDocumentValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            cancelDocumentRenameRef.current = true;
                            setRenamingDocumentId(null);
                          }
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        onBlur={() => {
                          const nextName = sanitizeWorkspaceName(renamingDocumentValue);
                          if (!cancelDocumentRenameRef.current && nextName) setDocuments((current) => current.map((item) =>
                            item.id === entry.id ? { ...item, name: nextName } : item,
                          ));
                          cancelDocumentRenameRef.current = false;
                          setRenamingDocumentId(null);
                        }}
                      />
                    ) : (
                      <button type="button" className="explorer-document-main" onClick={() => openDocument(activePane, entry.id)} title={`Open ${entry.name} in ${paneLabel(activePane)}`} aria-label={`Open ${entry.name} in ${paneLabel(activePane)}. Currently open in ${openPaneLabels(entry.id)}.${loaded ? "" : " File access needed."}`}>
                        <FileText size={17} aria-hidden="true" />
                        <span><strong title={entry.name}>{explorerDisplayName(entry.name)}</strong><small className={!loaded ? "needs-access" : ""} title={status?.message}>{loaded
                          ? status?.status === "error"
                            ? "Could not render PDF"
                            : status?.status === "opening"
                              ? "Opening PDF..."
                              : `PDF · ${entry.pageCount ? `${entry.pageCount} pages · ` : ""}${formatFileSize(loaded.file.size)}`
                          : "Needs file access"}</small></span>
                      </button>
                    )}
                    <button
                      data-explorer-actions
                      type="button"
                      className="explorer-more"
                      aria-label={`More actions for ${entry.name}`}
                      aria-expanded={openExplorerMenuId === entry.id}
                      onClick={() => setOpenExplorerMenuId((current) => current === entry.id ? null : entry.id)}
                    ><MoreHorizontal size={17} aria-hidden="true" /></button>
                  </div>
                  {!loaded ? <button type="button" className="explorer-access-button" onClick={() => void openCatalogPicker(entry)}>
                    <FolderOpen size={13} aria-hidden="true" /> Select original PDF
                  </button> : null}
                  {openExplorerMenuId === entry.id ? <div data-explorer-actions className="explorer-document-menu" aria-label={`Actions for ${entry.name}`}>
                    <button type="button" onClick={() => { openDocument(activePane === "left" ? "right" : "left", entry.id); setOpenExplorerMenuId(null); }}>Open in other pane</button>
                    <button type="button" onClick={() => { cancelDocumentRenameRef.current = false; setRenamingDocumentId(entry.id); setRenamingDocumentValue(entry.name); setOpenExplorerMenuId(null); }}>Rename</button>
                    <button type="button" onClick={() => { void openCatalogPicker(entry, activePane, true); setOpenExplorerMenuId(null); }}>Replace PDF</button>
                    <button type="button" disabled={index === 0} onClick={() => { setDocuments((current) => {
                      const next = [...current];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      return next;
                    }); setOpenExplorerMenuId(null); }}>Move up</button>
                    <button type="button" disabled={index === documents.length - 1} onClick={() => { setDocuments((current) => {
                      const next = [...current];
                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                      return next;
                    }); setOpenExplorerMenuId(null); }}>Move down</button>
                    <button type="button" className="danger" onClick={() => { removeDocument(entry); setOpenExplorerMenuId(null); }}>Remove from workspace</button>
                  </div> : null}
                </div>
              );
            })}
            {!documents.length ? <p className="explorer-empty">Drop PDFs here or use + to add documents.</p> : null}
          </div>
          <input
            ref={explorerPickerRef}
            className="sr-only"
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []).map((file) => ({ file }));
              const target = reattachTargetRef.current;
              const replaceTarget = replaceTargetRef.current;
              reattachTargetRef.current = null;
              replaceTargetRef.current = null;
              if (replaceTarget && selected[0]) void replaceDocument(replaceTarget, selected[0]);
              else if (target && selected[0]) void reattachDocument(target, selected[0]);
              else void addDocuments(selected, pickerSlotRef.current);
              event.target.value = "";
            }}
          />
        </aside>
      ) : null}
      {isExplorerOpen ? <div
        className="explorer-resizer"
        role="separator"
        aria-label="Resize Explorer"
        aria-orientation="vertical"
        aria-valuemin={240}
        aria-valuemax={440}
        aria-valuenow={explorerWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsResizingExplorer(true);
        }}
        onPointerMove={(event) => {
          if (!isResizingExplorer) return;
          const left = workbenchBodyRef.current?.getBoundingClientRect().left ?? 0;
          setExplorerWidth(Math.min(440, Math.max(240, event.clientX - left)));
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setIsResizingExplorer(false);
        }}
        onPointerCancel={() => setIsResizingExplorer(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setExplorerWidth((current) => Math.min(440, Math.max(240, current + (event.key === "ArrowLeft" ? -16 : 16))));
          }
        }}
      /> : null}
      <section
        ref={workspaceRef}
        className={`workspace ${isResizing ? "resizing" : ""} ${workspaceVisibilityClass}`}
        aria-label="Document upload workspace"
        style={{ "--left-panel-width": `${leftWidth}%` } as React.CSSProperties}
      >
        {showTorPane && tabs.left.activeId === tableId ? renderReviewTable("left") : showTorPane ? (
          <DropPanel
            id="tor-panel"
            title="Left pane"
            tone="version-a"
            uploadedFile={files.left}
            missingDocument={documents.find((item) => item.id === tabs.left.activeId)?.name}
            onSelect={(selected) => void addDocuments(selected, "left")}
            onOpenDocumentDrop={(id) => openDocument("left", id)}
            onMoveTabDrop={(from, id) => moveDocumentTab(from, "left", id)}
            toolbar={<EditorTabs
              slot="left"
              pane={tabs.left}
              documents={editorItems}
              onOpen={(id) => openDocument("left", id)}
              onClose={(id) => closeDocumentTab("left", id)}
              onMove={(from, id) => moveDocumentTab(from, "left", id)}
              onAdd={() => void openCatalogPicker(undefined, "left")}
              onDownload={() => void downloadAnnotatedEvidence(files.left)}
            />}
            previewProps={{
              side: "tor",
              pendingLinkId,
              interactionMode,
              evidenceTargetRowId: directEvidenceTargetId,
              neutralLinking: true,
              onStatusChange: files.left
                ? (status, pageCount, message) => recordDocumentStatus(files.left!.id, status, pageCount, message)
                : undefined,
              initialView: files.left ? documentViews[`left:${files.left.id}`] : undefined,
              onViewChange: files.left
                ? (view) => updateDocumentView("left", files.left!.id, view)
                : undefined,
              marks: marks.filter((mark) =>
                mark.documentId
                  ? mark.documentId === files.left?.id
                  : mark.fileName === files.left?.file.name,
              ),
              requirementNumbersByMarkId,
              colorsByMarkId,
              textPlacements: textPlacements.filter((placement) => placement.documentId === files.left?.id),
              textPlacementTarget: activeTextRow ? { rowId: activeTextRow.mark.id, text: activeTextRow.mark.text } : null,
              onPlaceText: files.left ? (page, x, y) => placeRequirementText(files.left!.id, page, x, y) : undefined,
              onMoveTextPlacement: (id, x, y, scale) => setTextPlacements((current) => current.map((placement) => placement.id === id ? { ...placement, x, y, ...(scale === undefined ? {} : { scale }) } : placement)),
              onRemoveTextPlacement: (id) => setTextPlacements((current) => current.filter((placement) => placement.id !== id)),
              onCreateMark: createEvidenceMark,
              onAutoPlaceMark: (id, labelPosition) =>
                setMarks((current) =>
                  current.map((mark) =>
                    mark.id === id && !mark.labelPosition ? { ...mark, labelPosition } : mark,
                  ),
                ),
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
        {showEvidencePane && tabs.right.activeId === tableId ? renderReviewTable("right") : showEvidencePane ? (
          <DropPanel
            id="evidence-panel"
            title="Right pane"
            tone="version-b"
            multiple
            uploadedFile={files.right}
            missingDocument={documents.find((item) => item.id === tabs.right.activeId)?.name}
            onSelect={(selected) => void addDocuments(selected, "right")}
            onOpenDocumentDrop={(id) => openDocument("right", id)}
            onMoveTabDrop={(from, id) => moveDocumentTab(from, "right", id)}
            previewProps={{
              side: "catalog",
              pendingLinkId,
              interactionMode,
              evidenceTargetRowId: directEvidenceTargetId,
              neutralLinking: true,
              onStatusChange: files.right
                ? (status, pageCount, message) => recordDocumentStatus(files.right!.id, status, pageCount, message)
                : undefined,
              initialView: files.right ? documentViews[`right:${files.right.id}`] : undefined,
              onViewChange: files.right
                ? (view) => updateDocumentView("right", files.right!.id, view)
                : undefined,
              marks: marks.filter((mark) =>
                mark.documentId
                  ? mark.documentId === files.right?.id
                  : mark.fileName === files.right?.file.name,
              ),
              requirementNumberByLinkId,
              requirementNumbersByMarkId,
              colorsByMarkId,
              textPlacements: textPlacements.filter((placement) => placement.documentId === files.right?.id),
              textPlacementTarget: activeTextRow ? { rowId: activeTextRow.mark.id, text: activeTextRow.mark.text } : null,
              onPlaceText: files.right ? (page, x, y) => placeRequirementText(files.right!.id, page, x, y) : undefined,
              onMoveTextPlacement: (id, x, y, scale) => setTextPlacements((current) => current.map((placement) => placement.id === id ? { ...placement, x, y, ...(scale === undefined ? {} : { scale }) } : placement)),
              onRemoveTextPlacement: (id) => setTextPlacements((current) => current.filter((placement) => placement.id !== id)),
              onAutoPlaceMark: (id, labelPosition) =>
                setMarks((current) =>
                  current.map((mark) =>
                    mark.id === id && !mark.labelPosition ? { ...mark, labelPosition } : mark,
                  ),
                ),
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
            toolbar={<EditorTabs
              slot="right"
              pane={tabs.right}
              documents={editorItems}
              onOpen={(id) => openDocument("right", id)}
              onClose={(id) => closeDocumentTab("right", id)}
              onMove={(from, id) => moveDocumentTab(from, "right", id)}
              onAdd={() => void openCatalogPicker(undefined, "right")}
              onDownload={() => void downloadAnnotatedEvidence(files.right)}
            />}
          />
        ) : null}
        {!showTorPane && !showEvidencePane ? (
          <div className="workspace-empty-state" role="status">
            <strong>No document panes shown</strong>
          <span>Use the pane buttons in the toolbar to show a document pane.</span>
          </div>
        ) : null}
      </section>
      </div>
      {interactionMode === "link" ? (
        <div className="link-mode-status" role="status">
          <Link2 aria-hidden="true" size={16} />
          {pendingLinkSourceId
            ? "Select another highlight or table row to link, or mark a PDF area"
            : "Select a highlight or mark a PDF area to start a link"}
          <button type="button" onClick={() => {
            setPendingLinkId(null);
            setPendingLinkSourceId(null);
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
            <span>{documents.length} PDFs · 1 Review Table · {highlightCount} highlights · {links.length} links</span>
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
            <div className="workspace-review-content">
              <div className="workspace-review-heading"><strong>HIGHLIGHTS</strong><span>{highlightCount}</span></div>
              {allHighlights.filter((mark) => reviewFilter === "all" ||
                (reviewFilter === "linked" ? isMarkLinked(mark) : !isMarkLinked(mark)),
              ).map((mark) => {
                const entry = documents.find((item) => item.id === mark.documentId);
                const available = catalogFiles.some((item) => item.id === mark.documentId);
                return (
                  <div className="workspace-highlight-row" key={mark.id}>
                    <button type="button" className="workspace-highlight-main" onClick={() => jumpToEvidenceMark(mark)}>
                      <span>{entry?.name ?? mark.fileName} · Page {mark.page}{available ? "" : " · Source unavailable"}</span>
                      <strong>{mark.text}</strong>
                      {mark.note ? <small>{mark.note}</small> : null}
                    </button>
                    <div className="workspace-highlight-actions">
                      <span>{isMarkLinked(mark) ? "Linked" : "Unlinked"}</span>
                      <button type="button" onClick={() => selectForWorkspaceLink(mark.id)} aria-label={`Link highlight on page ${mark.page}`} title="Link highlight"><Link2 size={15} aria-hidden="true" /></button>
                      <button type="button" onClick={() => removeEvidenceMark(mark)} aria-label={`Remove highlight on page ${mark.page}`} title="Remove highlight"><Trash2 size={15} aria-hidden="true" /></button>
                    </div>
                  </div>
                );
              })}
              {!allHighlights.length ? <p className="review-empty">No highlights yet. Select text or draw an area on a PDF.</p> : null}
              <div className="workspace-review-heading"><strong>LINKS</strong><span>{links.length}</span></div>
              {links.map((link) => {
                const source = marks.find((item) => item.id === link.sourceId);
                const target = marks.find((item) => item.id === link.targetId);
                return (
                  <div className="workspace-link-row" key={link.id}>
                    <div>
                      <button type="button" onClick={() => source && (tableRowIds.has(source.id) ? revealReviewTable(source.id) : jumpToEvidenceMark(source))}>{source && tableRowIds.has(source.id) ? `Row: ${source.text}` : source ? `${source.fileName} · p.${source.page}` : "Unresolved source"}</button>
                      <span aria-hidden="true">↔</span>
                      <button type="button" onClick={() => target && (tableRowIds.has(target.id) ? revealReviewTable(target.id) : jumpToEvidenceMark(target))}>{target && tableRowIds.has(target.id) ? `Row: ${target.text}` : target ? `${target.fileName} · p.${target.page}` : "Unresolved target"}</button>
                    </div>
                    <button type="button" onClick={() => setLinks((current) => current.filter((item) => item.id !== link.id))} aria-label="Remove link" title="Remove link"><Unlink2 size={15} aria-hidden="true" /></button>
                  </div>
                );
              })}
              {!links.length ? <p className="review-empty">Select Link on two highlights or a table row to connect them.</p> : null}
            </div>
        </div>
      </aside>
    </main>
  );
}
