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
  Columns2,
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
import type { EvidenceMark } from "./PdfPreview";
import type { RequirementGridRow } from "./RequirementGrid";

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

type ReviewFilter = "all" | "unlinked" | "linked";

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
  multiple = false,
  onSelect,
  onClear,
  toolbar,
  previewProps,
}: {
  title: string;
  tone: "version-a" | "version-b";
  uploadedFile: UploadedFile | null;
  multiple?: boolean;
  onSelect: (files: File[]) => void;
  onClear?: () => void;
  toolbar?: ReactNode;
  previewProps?: {
    side: "tor" | "catalog";
    pendingLinkId: string | null;
    interactionMode: "highlight" | "link";
    marks: EvidenceMark[];
    onCreateMark: (mark: EvidenceMark, intent: "highlight" | "link") => void;
  };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  const pickFiles = (selectedFiles: File[]) => {
    const candidates = multiple ? selectedFiles : selectedFiles.slice(0, 1);
    const accepted = candidates.filter(isAcceptedFile);
    const rejected = candidates.length - accepted.length;

    setError(
      rejected
        ? `ไม่เพิ่ม ${rejected} ไฟล์: รองรับเฉพาะ PDF และ DOCX`
        : "",
    );
    if (accepted.length) onSelect(accepted);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    pickFiles(Array.from(event.dataTransfer.files));
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    pickFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const clearFile = (event: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    setError("");
    onClear?.();
  };

  return (
    <section
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
              side={previewProps?.side ?? "tor"}
              pendingLinkId={previewProps?.pendingLinkId ?? null}
              interactionMode={previewProps?.interactionMode ?? "highlight"}
              marks={previewProps?.marks ?? []}
              onCreateMark={previewProps?.onCreateMark ?? (() => undefined)}
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
  const [leftWidth, setLeftWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [catalogFiles, setCatalogFiles] = useState<UploadedFile[]>([]);
  const [isCatalogMenuOpen, setIsCatalogMenuOpen] = useState(false);
  const [marks, setMarks] = useState<EvidenceMark[]>([]);
  const [pendingLinkId, setPendingLinkId] = useState<string | null>(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isReviewPinned, setIsReviewPinned] = useState(false);
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
  const sessionFilesRef = useRef<{
    tor: UploadedFile | null;
    catalogs: UploadedFile[];
  }>({ tor: null, catalogs: [] });
  const workspaceRef = useRef<HTMLElement>(null);
  const catalogMenuRef = useRef<HTMLDetailsElement>(null);
  const catalogPickerRef = useRef<HTMLInputElement>(null);

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

  const addCatalogFiles = (selectedFiles: File[]) => {
    const additions = selectedFiles.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    if (!additions.length) return;

    setCatalogFiles((current) => [...current, ...additions]);
    setFiles((current) => ({
      ...current,
      right: additions[0],
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
  };

  const clearSession = () => {
    if (!window.confirm("Remove the TOR and all Product Evidence files?")) {
      return;
    }

    setFiles((current) => {
      if (current.left) URL.revokeObjectURL(current.left.url);

      return { left: null, right: null };
    });
    catalogFiles.forEach((item) => URL.revokeObjectURL(item.url));
    setCatalogFiles([]);
    setIsCatalogMenuOpen(false);
    setMarks([]);
    setPendingLinkId(null);
    setInteractionMode("highlight");
  };

  const createEvidenceMark = (
    mark: EvidenceMark,
    intent: "highlight" | "link",
  ) => {
    if (intent === "link" && mark.side === "tor") {
      const linkId = crypto.randomUUID();
      setMarks((current) => [...current, { ...mark, linkId }]);
      setPendingLinkId(linkId);
      setInteractionMode("link");
      return;
    }

    setMarks((current) => [...current, mark]);
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
      idsByNumber.set(item.number, id);
      return { ...item, id };
    });
    setMarks((current) => [
      ...current,
      ...additions.map((item) => {
        const parentNumber = item.number.split(".").slice(0, -1).join(".");
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

    setMarks((current) => {
      const torItems = current.filter((item) => item.side === "tor");
      const flatten = (
        items: EvidenceMark[],
        prefix = "",
      ): Array<{ mark: EvidenceMark; path: string }> =>
        items.flatMap((item, index) => {
          const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
          const children = torItems.filter((child) => child.parentId === item.id);
          return [{ mark: item, path }, ...flatten(children, path)];
        });
      const flattened = flatten(torItems.filter((item) => !item.parentId));
      const parentPath = numberParts.slice(0, -1).join(".");
      const parent = parentPath
        ? flattened.find((item) => item.path === parentPath)?.mark
        : undefined;
      if (parentPath && !parent) return current;

      const byId = new Map(torItems.map((item) => [item.id, item]));
      let ancestorId = parent?.id;
      while (ancestorId) {
        if (ancestorId === mark.id) return current;
        ancestorId = byId.get(ancestorId)?.parentId;
      }

      const targetParentId = parent?.id;
      const targetPosition = numberParts.at(-1)! - 1;
      const reorderedTor = torItems.filter((item) => item.id !== mark.id);
      const siblings = reorderedTor.filter(
        (item) => item.parentId === targetParentId,
      );
      const beforeSibling = siblings[targetPosition];
      let insertionIndex = beforeSibling
        ? reorderedTor.findIndex((item) => item.id === beforeSibling.id)
        : reorderedTor.length;
      if (!beforeSibling && siblings.length) {
        insertionIndex =
          reorderedTor.findIndex(
            (item) => item.id === siblings[siblings.length - 1].id,
          ) + 1;
      }
      reorderedTor.splice(insertionIndex, 0, {
        ...mark,
        parentId: targetParentId,
        requirementNo: undefined,
      });

      let torIndex = 0;
      return current.map((item) =>
        item.side === "tor" ? reorderedTor[torIndex++] : item,
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
        item.id === mark.id ? { ...item, parentId } : item,
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
  const linkedCount = marks.filter(
    (mark) =>
      mark.side === "catalog" &&
      Boolean(mark.linkId && pairedLinkIds.has(mark.linkId)),
  ).length;
  const torMarks = marks.filter((mark) => mark.side === "tor");
  const unlinkedCatalogMarks = marks.filter(
    (mark) => mark.side === "catalog" &&
      (!mark.linkId || !pairedLinkIds.has(mark.linkId)),
  );
  const unlinkedCount = marks.filter(
    (mark) => !mark.linkId || !pairedLinkIds.has(mark.linkId),
  ).length;
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
      const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      const children = torMarks.filter((item) => item.parentId === mark.id);
      return [
        { mark, path, depth },
        ...flattenRequirements(children, path, depth + 1),
      ];
    });
  const requirementRows = flattenRequirements(rootRequirements).filter(({ mark }) =>
    visibleTorIds.has(mark.id),
  );
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
            <span>Highlights {marks.length}</span>
          </button>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            className="tool-button danger-tool"
            type="button"
            onClick={clearSession}
            disabled={!files.left && !catalogFiles.length}
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
          title="TOR / Requirements"
          tone="version-a"
          uploadedFile={files.left}
          onSelect={(selectedFiles) => setFileForSlot("left", selectedFiles[0])}
          onClear={() => clearFileForSlot("left")}
          previewProps={{
            side: "tor",
            pendingLinkId,
            interactionMode,
            marks: marks.filter(
              (mark) => mark.side === "tor" && mark.fileName === files.left?.file.name,
            ),
            onCreateMark: createEvidenceMark,
          }}
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
                  <span>Files {catalogFiles.length}</span>
                  <ChevronDown aria-hidden="true" size={14} />
                </summary>
                <div className="catalog-popover">
                  <div className="catalog-popover-heading">
                    <div>
                      <strong>Product Evidence</strong>
                      <span>{catalogFiles.length} documents</span>
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
                    {catalogFiles.length ? (
                      catalogFiles.map((item) => (
                        <div
                          className={`catalog-row ${
                            files.right?.url === item.url ? "active" : ""
                          }`}
                          key={item.url}
                        >
                          <button
                            className="catalog-row-main"
                            type="button"
                            onClick={() => {
                              setFiles((current) => ({
                                ...current,
                                right: item,
                              }));
                              setIsCatalogMenuOpen(false);
                            }}
                          >
                            <FileText aria-hidden="true" size={18} />
                            <span>
                              <strong>{item.file.name}</strong>
                              <small>
                                {isPdfFile(item.file) ? "PDF" : "DOCX"} ·{" "}
                                {formatFileSize(item.file.size)}
                              </small>
                            </span>
                          </button>
                          <button
                            className="catalog-row-remove"
                            type="button"
                            onClick={() => removeCatalogFile(item)}
                            aria-label={`Remove ${item.file.name}`}
                            title="Remove document"
                          >
                            <Trash2 aria-hidden="true" size={15} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="catalog-empty">No evidence documents yet</p>
                    )}
                  </div>

                  <button
                    className="catalog-add-button"
                    type="button"
                    onClick={() => catalogPickerRef.current?.click()}
                  >
                    <Plus aria-hidden="true" size={16} />
                    Add documents
                  </button>
                </div>
              </details>

              <button
                className="catalog-quick-add"
                type="button"
                onClick={() => catalogPickerRef.current?.click()}
                aria-label="Add Product Evidence documents"
                title="Add documents"
              >
                <Plus aria-hidden="true" size={16} />
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
                  if (accepted.length) addCatalogFiles(accepted);
                  event.target.value = "";
                }}
              />
            </div>
          }
        />
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
            <span>{torMarks.length} requirements · {marks.length} highlights</span>
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
                ? `All ${marks.length}`
                : filter === "unlinked"
                  ? `Unlinked ${unlinkedCount}`
                  : `Linked ${linkedCount}`}
            </button>
          ))}
        </div>
        <div className="review-list">
          <div className="requirement-list-toolbar">
            <strong>Requirements</strong>
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
          />
          {!marks.length ? (
            <p className="review-empty">Highlight a TOR section or add a requirement to begin.</p>
          ) : null}
          {marks.length && !visibleTorMarks.length &&
          !(showUnlinkedEvidence && unlinkedCatalogMarks.length) ? (
            <p className="review-empty">No highlights match this filter.</p>
          ) : null}
        </div>
      </aside>
    </main>
  );
}
