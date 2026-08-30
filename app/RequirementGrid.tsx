"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DataEditorRef,
  DataEditor,
  emptyGridSelection,
  GridCellKind,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { IndentDecrease, IndentIncrease } from "lucide-react";
import type { EvidenceMark } from "./PdfPreview";

export type RequirementGridRow =
  | {
      kind: "requirement";
      mark: EvidenceMark;
      path: string;
      depth: number;
      evidence: EvidenceMark[];
    }
  | {
      kind: "unassigned";
      mark: EvidenceMark;
      path: "";
      depth: 0;
      evidence: EvidenceMark[];
    };

type Props = {
  rows: RequirementGridRow[];
  showStartHint: boolean;
  onJump: (mark: EvidenceMark) => void;
  onUnlink: (mark: EvidenceMark) => void;
  onDropEvidence: (requirement: EvidenceMark, evidenceId: string) => void;
  onAddRequirement: (title: string) => void;
  onAddRequirements: (items: Array<{ number: string; title: string }>) => void;
  onRenameRequirement: (mark: EvidenceMark, title: string) => void;
  onRenameRequirementNo: (mark: EvidenceMark, number: string) => void;
  onChangeParent: (mark: EvidenceMark, parentId?: string) => void;
  isLinkMode: boolean;
  onSelectForLink: (mark: EvidenceMark) => void;
  onDeleteRequirements: (marks: EvidenceMark[]) => void;
};

const columns: GridColumn[] = [
  { id: "number", title: "No.", width: 68 },
  { id: "requirement", title: "Requirement", width: 230 },
  { id: "source", title: "Source", width: 110 },
  { id: "evidence", title: "Evidence", width: 300 },
];

const textCell = (data: string, themeOverride?: GridCell["themeOverride"]): GridCell => ({
  kind: GridCellKind.Text,
  allowOverlay: false,
  readonly: true,
  data,
  displayData: data,
  themeOverride,
});

const sourceCell = (mark: EvidenceMark, fallback: string): GridCell => {
  if (!mark.fileUrl) return textCell(fallback, { textDark: "#64748b" });

  return {
    kind: GridCellKind.Uri,
    allowOverlay: false,
    readonly: true,
    data: mark.fileUrl,
    displayData: mark.fileName,
    hoverEffect: true,
    themeOverride: { linkColor: "#5eead4" },
    onClickUri: ({ preventDefault }) => {
      preventDefault();
      window.open(mark.fileUrl, "_blank", "noopener,noreferrer");
    },
  };
};

export default function RequirementGrid({
  rows,
  showStartHint,
  onJump,
  onUnlink,
  onDropEvidence,
  onAddRequirement,
  onAddRequirements,
  onRenameRequirement,
  onRenameRequirementNo,
  onChangeParent,
  isLinkMode,
  onSelectForLink,
  onDeleteRequirements,
}: Props) {
  const gridRef = useRef<DataEditorRef>(null);
  const focusTrailingRow = useRef(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [gridSelection, setGridSelection] =
    useState<GridSelection>(emptyGridSelection);
  const selected = selectedRow === null ? null : rows[selectedRow] ?? null;

  useEffect(() => {
    if (!focusTrailingRow.current) return;
    focusTrailingRow.current = false;
    setGridSelection({
      ...emptyGridSelection,
      current: {
        cell: [1, rows.length],
        range: { x: 1, y: rows.length, width: 1, height: 1 },
        rangeStack: [],
      },
    });
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [rows.length]);

  const getCellContent = useCallback(
    ([column, rowIndex]: Item): GridCell => {
      if (rowIndex === rows.length) {
        if (column === 1) {
          return {
            kind: GridCellKind.Text,
            allowOverlay: true,
            readonly: false,
            data: "",
            displayData: "+ New requirement",
            themeOverride: { textDark: "#5eead4", bgCell: "#111827" },
          };
        }
        return textCell("", { bgCell: "#111827" });
      }
      const row = rows[rowIndex];
      if (!row) return textCell("");
      const isRequirement = row.kind === "requirement";
      const evidenceSummary = isRequirement
        ? (() => {
            const pages = [...new Set(row.evidence.map((item) => item.page))]
              .filter((page) => page > 0)
              .sort((a, b) => a - b);
            return pages.length ? `หน้า ${pages.join(", ")}` : "";
          })()
        : `หน้า ${row.mark.page}`;

      switch (column) {
        case 0:
          if (isRequirement) {
            const number =
              row.mark.requirementNo === undefined
                ? row.path
                : row.mark.requirementNo;
            return {
              kind: GridCellKind.Text,
              allowOverlay: true,
              readonly: false,
              data: number,
              displayData: number,
              themeOverride: { textDark: "#5eead4" },
            };
          }
          return textCell("", { textDark: "#64748b" });
        case 1:
          if (isRequirement) {
            return {
              kind: GridCellKind.Text,
              allowOverlay: true,
              readonly: false,
              data: row.mark.text,
              displayData: `${"  ".repeat(row.depth)}${row.mark.text}`,
              themeOverride: { textDark: "#e2e8f0" },
            };
          }
          return textCell("Unassigned evidence", { textDark: "#94a3b8" });
        case 2:
          return sourceCell(
            row.mark,
            row.mark.manual ? "Manual" : row.mark.fileName,
          );
        case 3:
          return textCell(evidenceSummary || "Drop evidence here", {
            textDark: evidenceSummary ? "#bfdbfe" : "#64748b",
          });
        default:
          return textCell("");
      }
    },
    [rows],
  );

  const onCellClicked = useCallback(
    ([column, rowIndex]: Item) => {
      const row = rows[rowIndex];
      if (!row) return;
      setSelectedRow(rowIndex);

      if (isLinkMode && row.kind === "requirement") {
        onSelectForLink(row.mark);
        return;
      }

      if (column === 1) {
        if (row.kind === "requirement" && !row.mark.manual) onJump(row.mark);
        return;
      }
      if (column === 3) {
        const target = row.kind === "requirement" ? row.evidence[0] : row.mark;
        if (target) onJump(target);
        return;
      }
    },
    [isLinkMode, onJump, onSelectForLink, rows],
  );

  const changeSelectedDepth = (isOutdent: boolean, fallbackIndex?: number) => {
    const selectedIndexes = new Set<number>(gridSelection.rows.toArray());
    const range = gridSelection.current?.range;
    if (range) {
      for (let index = range.y; index < range.y + range.height; index += 1) {
        selectedIndexes.add(index);
      }
    }
    if (fallbackIndex !== undefined) selectedIndexes.add(fallbackIndex);
    else if (selectedRow !== null) selectedIndexes.add(selectedRow);

    const targets = [...selectedIndexes]
      .sort((a, b) => a - b)
      .filter((index) => rows[index]?.kind === "requirement");
    const changes = targets.flatMap((rowIndex) => {
      const row = rows[rowIndex];
      if (row?.kind !== "requirement") return [];
      if (isOutdent) {
        if (!row.mark.parentId) return [];
        const parent = rows.find(
          (item) =>
            item.kind === "requirement" && item.mark.id === row.mark.parentId,
        );
        return [{
          mark: row.mark,
          parentId:
            parent?.kind === "requirement" ? parent.mark.parentId : undefined,
        }];
      }

      const previous = [...rows]
        .slice(0, rowIndex)
        .map((item, index) => ({ item, index }))
        .reverse()
        .find(
          ({ item, index }) =>
            item.kind === "requirement" &&
            item.depth === row.depth &&
            !selectedIndexes.has(index),
        );
      return previous?.item.kind === "requirement"
        ? [{ mark: row.mark, parentId: previous.item.mark.id }]
        : [];
    });
    changes.forEach(({ mark, parentId }) => onChangeParent(mark, parentId));
    return changes.length > 0;
  };

  return (
    <div className="glide-requirement-grid">
      <div className="requirement-grid-actions" role="toolbar" aria-label="Requirement level">
        <button type="button" onClick={() => changeSelectedDepth(false)} title="Indent (Ctrl + ])" aria-label="Indent selected requirements">
          <IndentIncrease aria-hidden="true" size={15} />
        </button>
        <button type="button" onClick={() => changeSelectedDepth(true)} title="Outdent (Ctrl + [)" aria-label="Outdent selected requirements">
          <IndentDecrease aria-hidden="true" size={15} />
        </button>
      </div>
      <DataEditor
        ref={gridRef}
        columns={columns}
        rows={rows.length + 1}
        getCellContent={getCellContent}
        gridSelection={gridSelection}
        onGridSelectionChange={setGridSelection}
        rangeSelect="multi-rect"
        rowSelect="multi"
        rowSelectionMode="multi"
        onPaste={(target, values) => {
          if (target[1] !== rows.length || target[0] !== 1) return false;
          const parsed: Array<{ number: string; title: string }> = [];
          values.flatMap((row) => row.join(" ").split(/\r?\n/)).forEach((rawLine) => {
            const line = rawLine.replace(/\*\*|__/g, "").trim();
            if (!line) return;
            const match = line.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/);
            if (match) {
              parsed.push({ number: match[1], title: match[2].trim() });
              return;
            }
            const previous = parsed.at(-1);
            if (previous) previous.title = `${previous.title} ${line}`.trim();
          });
          if (!parsed.length) return false;
          focusTrailingRow.current = true;
          onAddRequirements(parsed);
          return false;
        }}
        onDelete={(selection) => {
          const selectedIndexes = new Set<number>(selection.rows.toArray());
          const range = selection.current?.range;
          if (range) {
            for (let index = range.y; index < range.y + range.height; index += 1) {
              selectedIndexes.add(index);
            }
          }
          const selectedRequirements = [...selectedIndexes]
            .sort((a, b) => a - b)
            .flatMap((index) => {
              const row = rows[index];
              return row?.kind === "requirement" ? [row.mark] : [];
            });
          if (selectedRequirements.length) {
            onDeleteRequirements(selectedRequirements);
          }
          return false;
        }}
        onCellEdited={([column, rowIndex], value) => {
          if (value.kind !== GridCellKind.Text) return;
          if (column === 0 && rowIndex < rows.length) {
            const row = rows[rowIndex];
            if (row?.kind === "requirement") {
              onRenameRequirementNo(row.mark, value.data);
            }
            return;
          }
          if (column !== 1) return;
          const title = value.data.trim();
          if (!title) return;
          if (rowIndex === rows.length) {
            focusTrailingRow.current = true;
            onAddRequirement(title);
            return;
          }
          const row = rows[rowIndex];
          if (row?.kind === "requirement") onRenameRequirement(row.mark, title);
        }}
        onKeyDown={(event) => {
          const isIndent = event.ctrlKey && event.key === "]";
          const isOutdent = event.ctrlKey && event.key === "[";
          if ((!isIndent && !isOutdent) || !event.location) return;
          if (!changeSelectedDepth(isOutdent, event.location[1])) return;

          event.preventDefault();
          event.cancel();
        }}
        onCellClicked={onCellClicked}
        isDraggable="cell"
        onDragStart={(event) => {
          if (event.kind !== "cell") return;
          const row = rows[event.location[1]];
          if (row?.kind !== "unassigned") {
            event.preventDefault();
            return;
          }
          event.setData("application/x-comparex-evidence", row.mark.id);
        }}
        onDragOverCell={(_, transfer) => {
          if (transfer?.types.includes("application/x-comparex-evidence")) {
            transfer.dropEffect = "move";
          }
        }}
        onDrop={([, rowIndex], transfer) => {
          const row = rows[rowIndex];
          if (row?.kind !== "requirement" || !transfer) return;
          onDropEvidence(
            row.mark,
            transfer.getData("application/x-comparex-evidence"),
          );
        }}
        rowHeight={52}
        headerHeight={34}
        rowMarkers="checkbox-visible"
        smoothScrollX
        smoothScrollY
        width="100%"
        height="max(320px, calc(100vh - 230px))"
        theme={{
          accentColor: "#14b8a6",
          accentFg: "#f8fafc",
          bgCell: "#0f172a",
          bgCellMedium: "#111827",
          bgHeader: "#111827",
          bgHeaderHasFocus: "#1e293b",
          bgHeaderHovered: "#1e293b",
          borderColor: "#334155",
          textDark: "#e2e8f0",
          textHeader: "#94a3b8",
          textLight: "#64748b",
          fontFamily: "Arial, Helvetica, sans-serif",
          baseFontStyle: "12px",
          headerFontStyle: "600 11px",
        }}
      />
      {showStartHint ? (
        <p className="requirement-grid-empty-hint" role="status">
          Highlight a TOR section or add a requirement to begin.
        </p>
      ) : null}
      {selected?.kind === "requirement" && selected.evidence.length ? (
        <div className="grid-selection-detail">
          <strong>{selected.path} · Linked evidence</strong>
          {selected.evidence.map((evidence) => (
            <div key={evidence.id}>
              <button type="button" onClick={() => onJump(evidence)}>
                <span>{evidence.text}</span>
                <small>{evidence.fileName} · p.{evidence.page}</small>
              </button>
              <button
                type="button"
                onClick={() => onUnlink(evidence)}
                aria-label={`Unlink evidence on page ${evidence.page}`}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
