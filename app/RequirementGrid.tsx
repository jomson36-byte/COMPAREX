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
import { IndentDecrease, IndentIncrease, X } from "lucide-react";
import type { EvidenceMark } from "./PdfPreview";
import { parseNumberedRequirements } from "./requirementNumbering.mts";
import { evidenceCellSummary, evidenceTargetForCell } from "./workspaceTable.mts";

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
  onUnlink: (mark: EvidenceMark, requirement?: EvidenceMark) => void;
  onDropEvidence: (requirement: EvidenceMark, evidenceId: string) => void;
  onAddRequirement: (title: string) => void;
  onAddRequirements: (items: Array<{ number: string; title: string }>) => void;
  onRenameRequirement: (mark: EvidenceMark, title: string) => void;
  onRenameRequirementNo: (mark: EvidenceMark, number: string) => void;
  onChangeParent: (mark: EvidenceMark, parentId?: string) => void;
  isLinkMode: boolean;
  onSelectForLink: (mark: EvidenceMark) => void;
  onEvidenceTargetChange: (mark: EvidenceMark | null) => void;
  onDeleteRequirements: (marks: EvidenceMark[]) => void;
  onRemoveUnassignedEvidence: (mark: EvidenceMark) => void;
  focusMarkId?: string | null;
  onFocusHandled?: () => void;
  focusEvidenceMarkId?: string | null;
  onEvidenceFocusHandled?: () => void;
};

const initialColumns: GridColumn[] = [
  { id: "number", title: "No.", width: 56 },
  { id: "requirement", title: "Requirement", width: 190 },
  { id: "source", title: "Source", width: 92 },
  { id: "evidence", title: "Evidence", width: 150 },
];
const gridColumnStorageKey = "comparex.requirementGrid.columns.v1";

function readPersistedColumns() {
  try {
    const raw = window.localStorage.getItem(gridColumnStorageKey);
    if (!raw) return initialColumns;
    const saved = JSON.parse(raw) as Record<string, number>;
    return initialColumns.map((column) => {
      const width = saved[String(column.id)];
      return typeof width === "number"
        ? { ...column, width: Math.min(420, Math.max(44, width)) }
        : column;
    });
  } catch {
    return initialColumns;
  }
}

function writePersistedColumns(columns: GridColumn[]) {
  try {
    window.localStorage.setItem(
      gridColumnStorageKey,
      JSON.stringify(
        Object.fromEntries(
          columns.flatMap((column) =>
            "width" in column ? [[String(column.id), column.width]] : [],
          ),
        ),
      ),
    );
  } catch {
    // Column sizing is a preference; losing it should not interrupt review work.
  }
}

const textCell = (data: string, themeOverride?: GridCell["themeOverride"]): GridCell => ({
  kind: GridCellKind.Text,
  allowOverlay: false,
  readonly: true,
  data,
  displayData: data,
  themeOverride,
});

const sourceCell = (mark: EvidenceMark | undefined, fallback: string, onJump: (mark: EvidenceMark) => void): GridCell => {
  if (!mark?.fileUrl) return textCell(fallback, { textDark: "#64748b" });

  return {
    kind: GridCellKind.Uri,
    allowOverlay: false,
    readonly: true,
    data: mark.fileUrl,
    displayData: fallback,
    hoverEffect: true,
    themeOverride: { linkColor: "#5eead4" },
    onClickUri: ({ preventDefault }) => {
      preventDefault();
      onJump(mark);
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
  onEvidenceTargetChange,
  onDeleteRequirements,
  onRemoveUnassignedEvidence,
  focusMarkId,
  onFocusHandled,
  focusEvidenceMarkId,
  onEvidenceFocusHandled,
}: Props) {
  const gridRef = useRef<DataEditorRef>(null);
  const focusTrailingRow = useRef(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [isEvidenceDetailOpen, setIsEvidenceDetailOpen] = useState(false);
  const [gridColumns, setGridColumns] = useState<GridColumn[]>(initialColumns);
  const [hasRestoredColumns, setHasRestoredColumns] = useState(false);
  const [gridSelection, setGridSelection] =
    useState<GridSelection>(emptyGridSelection);
  const selected = selectedRow === null ? null : rows[selectedRow] ?? null;

  useEffect(() => {
    setGridColumns(readPersistedColumns());
    setHasRestoredColumns(true);
  }, []);

  useEffect(() => {
    if (hasRestoredColumns) writePersistedColumns(gridColumns);
  }, [gridColumns, hasRestoredColumns]);

  const handleGridSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
      const selectedIndex = selection.current?.cell[1];
      if (selectedIndex !== undefined && rows[selectedIndex]) setSelectedRow(selectedIndex);
      if (selection.current) {
        const target = isLinkMode ? null : evidenceTargetForCell(rows, selection.current.cell);
        onEvidenceTargetChange(target?.mark ?? null);
      }
    },
    [isLinkMode, onEvidenceTargetChange, rows],
  );

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

  useEffect(() => {
    if (!focusMarkId) return;
    const rowIndex = rows.findIndex((row) => row.mark.id === focusMarkId);
    if (rowIndex < 0) return;
    setSelectedRow(rowIndex);
    setIsEvidenceDetailOpen(false);
    setGridSelection({
      ...emptyGridSelection,
      current: {
        cell: [1, rowIndex],
        range: { x: 1, y: rowIndex, width: 1, height: 1 },
        rangeStack: [],
      },
    });
    requestAnimationFrame(() => {
      gridRef.current?.scrollTo(1, rowIndex, "both", 12, 12, { vAlign: "center" });
      gridRef.current?.focus();
      onFocusHandled?.();
    });
  }, [focusMarkId, onFocusHandled, rows]);

  useEffect(() => {
    if (!focusEvidenceMarkId) return;
    const rowIndex = rows.findIndex((row) => row.kind === "requirement" && row.mark.id === focusEvidenceMarkId);
    if (rowIndex < 0) return;
    setSelectedRow(rowIndex);
    setIsEvidenceDetailOpen(false);
    setGridSelection({
      ...emptyGridSelection,
      current: {
        cell: [3, rowIndex],
        range: { x: 3, y: rowIndex, width: 1, height: 1 },
        rangeStack: [],
      },
    });
    requestAnimationFrame(() => {
      gridRef.current?.scrollTo(3, rowIndex, "both", 12, 12, { vAlign: "center" });
      onEvidenceFocusHandled?.();
    });
  }, [focusEvidenceMarkId, onEvidenceFocusHandled, rows]);

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
      const sourceMark = isRequirement && row.mark.manual ? undefined : row.mark;
      const sourceLabel = isRequirement && row.mark.manual
        ? "Manual row"
        : `${row.mark.fileName} · p.${row.mark.page}`;
      const evidenceSummary = isRequirement
        ? evidenceCellSummary(row.evidence)
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
            sourceMark,
            sourceLabel,
            onJump,
          );
        case 3:
          return textCell(evidenceSummary || "Add evidence", {
            textDark: evidenceSummary ? "#bfdbfe" : "#64748b",
          });
        default:
          return textCell("");
      }
    },
    [onJump, rows],
  );

  const onCellClicked = useCallback(
    ([column, rowIndex]: Item) => {
      const row = rows[rowIndex];
      if (!row) return;
      setSelectedRow(rowIndex);
      onEvidenceTargetChange(!isLinkMode && column === 3 && row.kind === "requirement" ? row.mark : null);

      if (isLinkMode && row.kind === "requirement") {
        onSelectForLink(row.mark);
        return;
      }

      if (column === 1) {
        if (row.kind === "requirement" && !row.mark.manual) onJump(row.mark);
        return;
      }
      if (column === 3) {
        if (row.kind === "requirement") setIsEvidenceDetailOpen(true);
        return;
      }
    },
    [isLinkMode, onEvidenceTargetChange, onJump, onSelectForLink, rows],
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
      <div className="requirement-grid-canvas">
      <DataEditor
        ref={gridRef}
        columns={gridColumns}
        rows={rows.length + 1}
        getCellContent={getCellContent}
        gridSelection={gridSelection}
        onGridSelectionChange={handleGridSelectionChange}
        onColumnResize={(_, newSize, colIndex) => {
          setGridColumns((current) =>
            current.map((column, index) =>
              index === colIndex ? { ...column, width: newSize } : column,
            ),
          );
        }}
        minColumnWidth={44}
        maxColumnWidth={420}
        rangeSelect="multi-rect"
        rowSelect="multi"
        rowSelectionMode="multi"
        onPaste={(target, values) => {
          if (target[1] !== rows.length || target[0] !== 1) return false;
          const parsed = parseNumberedRequirements(
            values.map((row) => row.join("\t")).join("\n"),
          );
          if (!parsed.length) return false;
          focusTrailingRow.current = true;
          onAddRequirements(parsed);
          return false;
        }}
        onDelete={(selection) => {
          const selectedRows = new Set<number>(selection.rows.toArray());
          const selectedCells = new Map<number, Set<number>>();
          const addSelectedRange = (range: {
            x: number;
            y: number;
            width: number;
            height: number;
          }) => {
            for (let rowIndex = range.y; rowIndex < range.y + range.height; rowIndex += 1) {
              for (let columnIndex = range.x; columnIndex < range.x + range.width; columnIndex += 1) {
                const rowCells = selectedCells.get(rowIndex) ?? new Set<number>();
                rowCells.add(columnIndex);
                selectedCells.set(rowIndex, rowCells);
              }
            }
          };
          if (selection.current?.range) addSelectedRange(selection.current.range);
          selection.current?.rangeStack.forEach(addSelectedRange);

          if (!selectedRows.size) {
            const selectedEvidence = [...selectedCells]
              .flatMap(([rowIndex, columns]) => {
                const row = rows[rowIndex];
                if (!columns.has(3)) return [];
                if (row?.kind === "requirement") return row.evidence;
                if (row?.kind === "unassigned") return [row.mark];
                return [];
              })
              .filter(
                (mark, index, allMarks) =>
                  allMarks.findIndex((item) => item.id === mark.id) === index,
              );

            if (selectedEvidence.length) {
              selectedEvidence.forEach(onRemoveUnassignedEvidence);
              return false;
            }
          }

          const selectedIndexes = new Set(selectedRows);
          selectedCells.forEach((columns, rowIndex) => {
            if (columns.has(0) || columns.has(1)) selectedIndexes.add(rowIndex);
          });

          const selectedRequirements = [...selectedIndexes]
            .sort((a, b) => a - b)
            .flatMap((index) => {
              const row = rows[index];
              return row?.kind === "requirement" ? [row.mark] : [];
            });
          const selectedUnassignedEvidence = [...selectedIndexes]
            .sort((a, b) => a - b)
            .flatMap((index) => {
              const row = rows[index];
              return row?.kind === "unassigned" ? [row.mark] : [];
            });
          if (selectedRequirements.length) {
            onDeleteRequirements(selectedRequirements);
          }
          if (
            selectedUnassignedEvidence.length &&
            window.confirm(
              `Remove ${selectedUnassignedEvidence.length} unassigned evidence highlight${selectedUnassignedEvidence.length === 1 ? "" : "s"}?`,
            )
          ) {
            selectedUnassignedEvidence.forEach(onRemoveUnassignedEvidence);
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
            const parsed = parseNumberedRequirements(title);
            if (parsed.length) onAddRequirements(parsed);
            else onAddRequirement(title);
            return;
          }
          const row = rows[rowIndex];
          if (row?.kind === "requirement") onRenameRequirement(row.mark, title);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && isEvidenceDetailOpen) {
            setIsEvidenceDetailOpen(false);
            event.preventDefault();
            event.cancel();
            return;
          }
          if (event.key === "Enter" && event.location?.[0] === 3) {
            const rowIndex = event.location[1];
            if (rows[rowIndex]?.kind === "requirement" && !isLinkMode) {
              setSelectedRow(rowIndex);
              onEvidenceTargetChange(rows[rowIndex].mark);
              setIsEvidenceDetailOpen(true);
              event.preventDefault();
              event.cancel();
              return;
            }
          }
          if (event.key === "Enter" && isLinkMode && event.location) {
            const row = rows[event.location[1]];
            if (row?.kind === "requirement") {
              onSelectForLink(row.mark);
              event.preventDefault();
              event.cancel();
              return;
            }
          }
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
        rowMarkers="none"
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
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
      </div>
      {showStartHint ? (
        <p className="requirement-grid-empty-hint" role="status">
          Add a row to begin reviewing documents.
        </p>
      ) : null}
      {isEvidenceDetailOpen && selected?.kind === "requirement" ? (
        <section className="grid-selection-detail" aria-label={`Evidence for requirement ${selected.path}`}>
          <div className="grid-selection-detail-header">
            <strong>{selected.path} · {evidenceCellSummary(selected.evidence) || "No evidence"}</strong>
            <button type="button" onClick={() => setIsEvidenceDetailOpen(false)} aria-label="Close evidence list">
              <X aria-hidden="true" size={15} />
            </button>
          </div>
          {selected.evidence.length ? (
            <div className="grid-selection-detail-list">
              {selected.evidence.map((evidence) => (
                <div className="grid-selection-detail-item" key={evidence.id}>
                  <div className="grid-selection-detail-info">
                    <strong title={evidence.fileName}>{evidence.fileName}</strong>
                    <span>Page {evidence.page} · {evidence.text || "Area highlight"}</span>
                  </div>
                  <button type="button" onClick={() => onJump(evidence)} aria-label={`Open evidence in ${evidence.fileName}, page ${evidence.page}`}>
                    Open PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnlink(evidence, selected.mark)}
                    aria-label={`Unlink evidence in ${evidence.fileName}, page ${evidence.page}`}
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p>No linked evidence. Select this row in Link mode to add a highlight.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
