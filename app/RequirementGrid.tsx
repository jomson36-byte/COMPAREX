"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  type DataEditorRef,
  DataEditor,
  CompactSelection,
  emptyGridSelection,
  GridCellKind,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type { EvidenceMark } from "./PdfPreview";
import { isRowBorderGrabPoint, linkTargetForCell, selectedRowGroups, tableLinkAtColumn, tableRowMovePreview } from "./workspaceTable.mts";
import { columnLinkColor, linkColors, linkColorStyle, type LinkColor } from "./linkColors.mts";

export type ReviewTableLink = { mark: EvidenceMark; color: LinkColor; column: number };

export type RequirementGridRow =
  | {
      kind: "requirement";
      mark: EvidenceMark;
      path: string;
      links: ReviewTableLink[];
    }
  | {
      kind: "unassigned";
      mark: EvidenceMark;
      path: "";
      links: ReviewTableLink[];
    };

type Props = {
  rows: RequirementGridRow[];
  linkColumnCount: number;
  linkColumnColors: Readonly<Record<string, LinkColor>>;
  onAddLinkColumn: () => void;
  onChangeColumnColor: (column: number, color: LinkColor) => void;
  showStartHint: boolean;
  onJump: (mark: EvidenceMark) => void;
  onDropEvidence: (requirement: EvidenceMark, evidenceId: string) => void;
  onAddRequirement: (title: string) => void;
  onAddRequirements: (items: Array<{ number: string; title: string }>) => void;
  onRenameRequirement: (mark: EvidenceMark, title: string) => void;
  onRenameRequirementNo: (mark: EvidenceMark, number: string) => void;
  onMoveRequirements: (sourceIds: string[], targetId: string, edge: "before" | "after") => void;
  isLinkMode: boolean;
  onSelectForLink: (mark: EvidenceMark) => void;
  onEvidenceTargetChange: (mark: EvidenceMark | null, column?: number) => void;
  onRequirementTargetChange: (mark: EvidenceMark | null) => void;
  placedTextCountByRow: ReadonlyMap<string, number>;
  onJumpToPlacedText: (rowId: string) => void;
  onOpenPlacedTextMenu: (rowId: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  onDeletePlacedText: (rowIds: string[]) => void;
  activeLinkRowId?: string | null;
  activeLinkColumn?: number | null;
  onDeleteRequirements: (marks: EvidenceMark[]) => void;
  onRemoveHighlight: (mark: EvidenceMark) => void;
  focusMarkId?: string | null;
  onFocusHandled?: () => void;
  focusEvidenceMarkId?: string | null;
  onEvidenceFocusHandled?: () => void;
};

const baseColumns = [
  { id: "number", title: "No.", width: 56 },
  { id: "requirement", title: "Requirement", width: 190 },
] satisfies GridColumn[];
const gridColumnStorageKey = "comparex.requirementGrid.columns.v1";

function readPersistedColumnWidths(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(gridColumnStorageKey);
    if (!raw) return {};
    const saved: unknown = JSON.parse(raw);
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved as Record<string, number>
      : {};
  } catch {
    return {};
  }
}

function writePersistedColumnWidths(widths: Record<string, number>) {
  try {
    window.localStorage.setItem(gridColumnStorageKey, JSON.stringify(widths));
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

const linkCell = (link: ReviewTableLink, isLinkMode: boolean): GridCell => {
  const { mark } = link;
  const color = linkColorStyle(link.color);
  const label = `${mark.fileName} · p.${mark.page}`;
  if (isLinkMode) return textCell(label, { textDark: color.ink, bgCell: color.cell });
  return {
    kind: GridCellKind.Uri,
    allowOverlay: false,
    readonly: true,
    data: mark.fileUrl ?? `comparex-mark:${mark.id}`,
    displayData: label,
    hoverEffect: true,
    themeOverride: { linkColor: color.ink, bgCell: color.cell },
    onClickUri: ({ preventDefault }) => {
      preventDefault();
    },
  };
};

export default function RequirementGrid({
  rows,
  linkColumnCount,
  linkColumnColors,
  onAddLinkColumn,
  onChangeColumnColor,
  showStartHint,
  onJump,
  onDropEvidence,
  onAddRequirement,
  onAddRequirements,
  onRenameRequirement,
  onRenameRequirementNo,
  onMoveRequirements,
  isLinkMode,
  onSelectForLink,
  onEvidenceTargetChange,
  onRequirementTargetChange,
  placedTextCountByRow,
  onJumpToPlacedText,
  onOpenPlacedTextMenu,
  onDeletePlacedText,
  activeLinkRowId,
  activeLinkColumn,
  onDeleteRequirements,
  onRemoveHighlight,
  focusMarkId,
  onFocusHandled,
  focusEvidenceMarkId,
  onEvidenceFocusHandled,
}: Props) {
  const gridRef = useRef<DataEditorRef>(null);
  const gridCanvasRef = useRef<HTMLDivElement>(null);
  const rowDragStart = useRef<{ pointerId: number; sourceIndex: number; sourceIndexes: number[]; startY: number } | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const focusTrailingRow = useRef(false);
  const focusNewColumn = useRef(false);
  const focusMovedRows = useRef<{ ids: string[]; fromIndexes: number[]; focusId: string } | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedMarkerRows, setSelectedMarkerRows] = useState<number[]>([]);
  const [isBorderHover, setIsBorderHover] = useState(false);
  const [rowDrag, setRowDrag] = useState<{
    sourceIndex: number;
    sourceCount: number;
    targetIndex: number;
    valid: boolean;
    lineTop: number;
    ghostTop: number;
  } | null>(null);
  const [moveMessage, setMoveMessage] = useState("");
  const [deleteNotice, setDeleteNotice] = useState("");
  const [colorPicker, setColorPicker] = useState<{ column: number; left: number; top: number } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [hasRestoredColumns, setHasRestoredColumns] = useState(false);
  const [gridSelection, setGridSelection] =
    useState<GridSelection>(emptyGridSelection);
  const columnCount = rows.reduce((count, row) => Math.max(count, ...row.links.map((link) => link.column)), Math.max(1, linkColumnCount));
  const lastLinkColumnExclusive = 2 + columnCount;
  const gridColumns = useMemo(() => [
    ...baseColumns,
    ...Array.from({ length: columnCount }, (_, index) => {
      const color = linkColorStyle(columnLinkColor(linkColumnColors, index + 1));
      return {
        id: `link-${index + 1}`,
        title: `Link ${index + 1}`,
        width: 164,
        hasMenu: true,
        themeOverride: {
          accentColor: color.fill,
          accentFg: "#f8fafc",
          bgHeader: color.cell,
          bgHeaderHasFocus: color.cell,
          bgHeaderHovered: color.cell,
          textHeader: color.ink,
        },
      };
    }),
  ].map((column) => {
    const savedWidth = columnWidths[column.id];
    return {
      ...column,
      width: Math.min(420, Math.max(44, Number.isFinite(savedWidth) ? savedWidth : column.width)),
    };
  }), [columnWidths, columnCount, linkColumnColors]);

  useEffect(() => {
    setColumnWidths(readPersistedColumnWidths());
    setHasRestoredColumns(true);
  }, []);

  useEffect(() => {
    if (hasRestoredColumns) writePersistedColumnWidths(columnWidths);
  }, [columnWidths, hasRestoredColumns]);

  const openColumnColorPicker = useCallback((columnIndex: number, bounds?: { x: number; y: number; width: number; height: number }) => {
    if (columnIndex < 2 || columnIndex >= lastLinkColumnExclusive) return;
    const header = bounds ?? gridRef.current?.getBounds(columnIndex, -1);
    if (!header) return;
    setColorPicker({
      column: columnIndex - 1,
      left: Math.max(8, Math.min(window.innerWidth - 204, header.x)),
      top: Math.max(8, Math.min(window.innerHeight - 230, header.y + header.height + 4)),
    });
  }, [lastLinkColumnExclusive]);

  useEffect(() => {
    if (!colorPicker) return;
    colorPickerRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!colorPickerRef.current?.contains(event.target as Node)) setColorPicker(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setColorPicker(null);
        gridRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [colorPicker]);

  useEffect(() => {
    if (!deleteNotice) return;
    const timeout = window.setTimeout(() => setDeleteNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [deleteNotice]);

  useEffect(() => {
    if (!focusNewColumn.current) return;
    focusNewColumn.current = false;
    requestAnimationFrame(() => gridRef.current?.scrollTo(lastLinkColumnExclusive - 1, 0, "horizontal", 12, 0));
  }, [lastLinkColumnExclusive]);

  const handleGridSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
      const markerRows = selection.rows.toArray().filter((index) => index < rows.length);
      setSelectedMarkerRows(markerRows);
      if (markerRows.length) setSelectedRow(markerRows.at(-1)!);
      const selectedIndex = selection.current?.cell[1];
      if (selectedIndex !== undefined && rows[selectedIndex]) setSelectedRow(selectedIndex);
      if (selection.current) {
        const target = isLinkMode ? null : linkTargetForCell(rows, selection.current.cell, columnCount);
        onEvidenceTargetChange(target?.mark ?? null, target ? selection.current.cell[0] - 1 : undefined);
        const [column, rowIndex] = selection.current.cell;
        const row = rows[rowIndex];
        onRequirementTargetChange(!isLinkMode && column === 1 && row?.kind === "requirement" && !placedTextCountByRow.get(row.mark.id) ? row.mark : null);
      } else {
        onRequirementTargetChange(null);
      }
    },
    [columnCount, isLinkMode, onEvidenceTargetChange, onRequirementTargetChange, placedTextCountByRow, rows],
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
    const moved = focusMovedRows.current;
    if (!moved) return;
    const indexes = moved.ids.map((id) => rows.findIndex((row) => row.mark.id === id));
    if (indexes.some((index) => index < 0)) {
      focusMovedRows.current = null;
      return;
    }
    if (indexes.every((index, position) => index === moved.fromIndexes[position])) {
      focusMovedRows.current = null;
      return;
    }
    focusMovedRows.current = null;
    const focusIndex = rows.findIndex((row) => row.mark.id === moved.focusId);
    setSelectedRow(focusIndex);
    setSelectedMarkerRows(indexes);
    setGridSelection({
      ...emptyGridSelection,
      rows: CompactSelection.fromArray(indexes),
      current: {
        cell: [1, focusIndex],
        range: { x: 1, y: focusIndex, width: 1, height: 1 },
        rangeStack: [],
      },
    });
  }, [rows]);

  useEffect(() => {
    if (!focusMarkId) return;
    const rowIndex = rows.findIndex((row) => row.mark.id === focusMarkId);
    if (rowIndex < 0) return;
    setSelectedRow(rowIndex);
    setSelectedMarkerRows([]);
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
    const column = Math.min(lastLinkColumnExclusive - 1, Math.max(2, 1 + (activeLinkColumn ?? 1)));
    setSelectedRow(rowIndex);
    setSelectedMarkerRows([]);
    setGridSelection({
      ...emptyGridSelection,
      current: {
        cell: [column, rowIndex],
        range: { x: column, y: rowIndex, width: 1, height: 1 },
        rangeStack: [],
      },
    });
    requestAnimationFrame(() => {
      gridRef.current?.scrollTo(column, rowIndex, "both", 12, 12, { vAlign: "center" });
      onEvidenceFocusHandled?.();
    });
  }, [activeLinkColumn, focusEvidenceMarkId, lastLinkColumnExclusive, onEvidenceFocusHandled, rows]);

  useEffect(() => {
    if (!activeLinkRowId || !gridSelection.current) return;
    const rowIndex = rows.findIndex((row) => row.kind === "requirement" && row.mark.id === activeLinkRowId);
    const column = Math.min(lastLinkColumnExclusive - 1, Math.max(2, 1 + (activeLinkColumn ?? 1)));
    if (rowIndex < 0 || gridSelection.current.cell[1] !== rowIndex || gridSelection.current.cell[0] === column) return;
    setGridSelection({
      ...emptyGridSelection,
      current: {
        cell: [column, rowIndex],
        range: { x: column, y: rowIndex, width: 1, height: 1 },
        rangeStack: [],
      },
    });
    requestAnimationFrame(() => gridRef.current?.scrollTo(column, rowIndex, "both", 12, 12));
  }, [activeLinkColumn, activeLinkRowId, gridSelection.current, lastLinkColumnExclusive, rows]);

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

      switch (column) {
        case 0:
          if (isRequirement) {
            const number = row.mark.requirementNo ?? "";
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
            const placedCount = placedTextCountByRow.get(row.mark.id) ?? 0;
            if (placedCount && !isLinkMode) {
              return {
                kind: GridCellKind.Uri,
                allowOverlay: true,
                readonly: false,
                data: row.mark.text,
                displayData: row.mark.text,
                hoverEffect: true,
                themeOverride: { linkColor: "#93c5fd" },
                onClickUri: ({ preventDefault }) => preventDefault(),
              };
            }
            return {
              kind: GridCellKind.Text,
              allowOverlay: true,
              readonly: false,
              data: row.mark.text,
              displayData: row.mark.text,
              themeOverride: { textDark: placedCount ? "#93c5fd" : "#e2e8f0" },
            };
          }
          return textCell("Unlinked highlight", { textDark: "#94a3b8" });
        default:
          if (column > 1 && column < lastLinkColumnExclusive) {
            const link = tableLinkAtColumn(row.links, column);
            const color = linkColorStyle(columnLinkColor(linkColumnColors, column - 1));
            return link ? linkCell(link, isLinkMode) : isRequirement
              ? textCell("+ Add link", { textDark: color.ink, bgCell: color.cell })
              : textCell("", { bgCell: color.cell });
          }
          return textCell("");
      }
    },
    [isLinkMode, lastLinkColumnExclusive, linkColumnColors, placedTextCountByRow, rows],
  );

  const onCellClicked = useCallback(
    ([column, rowIndex]: Item) => {
      const row = rows[rowIndex];
      if (!row) return;
      setSelectedRow(rowIndex);
      const target = !isLinkMode ? linkTargetForCell(rows, [column, rowIndex], columnCount) : null;
      onEvidenceTargetChange(target?.mark ?? null, target ? column - 1 : undefined);
      const hasPlacedText = row.kind === "requirement" && Boolean(placedTextCountByRow.get(row.mark.id));
      onRequirementTargetChange(!isLinkMode && column === 1 && row.kind === "requirement" && !hasPlacedText ? row.mark : null);

      if (isLinkMode && row.kind === "requirement") {
        onSelectForLink(row.mark);
        return;
      }

      if (column === 1 && hasPlacedText) {
        onJumpToPlacedText(row.mark.id);
        requestAnimationFrame(() => gridRef.current?.focus());
        return;
      }

      if (column > 1 && column < lastLinkColumnExclusive) {
        const link = tableLinkAtColumn(row.links, column);
        if (link) {
          onJump(link.mark);
          requestAnimationFrame(() => gridRef.current?.focus());
        }
        return;
      }
    },
    [columnCount, isLinkMode, lastLinkColumnExclusive, onEvidenceTargetChange, onJump, onJumpToPlacedText, onRequirementTargetChange, onSelectForLink, placedTextCountByRow, rows],
  );

  const moveIndexesFor = (fromIndex: number, capturedIndexes?: readonly number[]) => {
    const indexes = capturedIndexes ?? (selectedMarkerRows.includes(fromIndex) ? selectedMarkerRows : [fromIndex]);
    return [...new Set(indexes.filter((index) => rows[index]?.kind === "requirement"))].sort((a, b) => a - b);
  };

  const adjacentRowIndex = (direction: -1 | 1) => {
    if (selectedRow === null || rows[selectedRow]?.kind !== "requirement") return -1;
    const indexes = moveIndexesFor(selectedRow);
    const edge = direction < 0 ? indexes[0] : indexes.at(-1)!;
    for (let index = edge + direction; index >= 0 && index < rows.length; index += direction) {
      if (rows[index]?.kind === "requirement" && !indexes.includes(index)) return index;
    }
    return -1;
  };

  const moveRow = (fromIndex: number, toIndex: number, capturedIndexes?: readonly number[]) => {
    const source = rows[fromIndex];
    const target = rows[toIndex];
    if (source?.kind !== "requirement" || target?.kind !== "requirement") {
      setMoveMessage("Only Requirement rows can be moved.");
      return;
    }
    const sourceIndexes = moveIndexesFor(fromIndex, capturedIndexes);
    const preview = tableRowMovePreview(rows, fromIndex, toIndex, sourceIndexes);
    if (!preview.valid) {
      setMoveMessage("Choose a row outside the selection.");
      return;
    }
    const sourceIds = sourceIndexes.map((index) => rows[index].mark.id);
    focusMovedRows.current = { ids: sourceIds, fromIndexes: sourceIndexes, focusId: source.mark.id };
    setMoveMessage("");
    onEvidenceTargetChange(null);
    onRequirementTargetChange(null);
    onMoveRequirements(sourceIds, target.mark.id, preview.edge === "bottom" ? "after" : "before");
  };

  const moveSelectedRows = (direction: -1 | 1) => {
    if (selectedRow === null) return;
    const indexes = moveIndexesFor(selectedRow);
    const fromIndex = direction < 0 ? indexes[0] : indexes.at(-1);
    const targetIndex = adjacentRowIndex(direction);
    if (fromIndex !== undefined && targetIndex >= 0) moveRow(fromIndex, targetIndex, indexes);
  };

  const rowIndexAt = (clientY: number) => {
    const canvas = gridCanvasRef.current;
    if (!canvas || clientY < canvas.getBoundingClientRect().top + 34 ||
        clientY >= canvas.getBoundingClientRect().bottom) return -1;
    let low = 0;
    let high = rows.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const bounds = gridRef.current?.getBounds(0, middle);
      if (!bounds) return -1;
      if (clientY < bounds.y) high = middle - 1;
      else if (clientY >= bounds.y + bounds.height) low = middle + 1;
      else return middle;
    }
    return -1;
  };

  const selectedBorderAt = (clientX: number, clientY: number) => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return null;
    const viewport = canvas.getBoundingClientRect();
    if (clientX < viewport.left || clientX >= viewport.right ||
        clientY < viewport.top + 34 || clientY >= viewport.bottom) return null;
    for (const group of selectedRowGroups(selectedMarkerRows)) {
      const firstMovableIndex = selectedMarkerRows.find((index) =>
        index >= group.start && index <= group.end && rows[index]?.kind === "requirement",
      );
      if (firstMovableIndex === undefined) continue;
      const first = gridRef.current?.getBounds(0, group.start);
      const last = gridRef.current?.getBounds(gridColumns.length - 1, group.end);
      if (!first || !last) continue;
      const border = {
        x: first.x + 2,
        y: first.y + 2,
        width: last.x + last.width - first.x - 4,
        height: last.y + last.height - first.y - 4,
      };
      if (isRowBorderGrabPoint({ x: clientX, y: clientY }, border)) {
        const hitRow = rowIndexAt(clientY);
        return hitRow >= group.start && hitRow <= group.end && rows[hitRow]?.kind === "requirement"
          ? hitRow
          : firstMovableIndex;
      }
    }
    return null;
  };

  const onGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const sourceIndex = selectedBorderAt(event.clientX, event.clientY);
    if (sourceIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    rowDragStart.current = {
      pointerId: event.pointerId,
      sourceIndex,
      sourceIndexes: moveIndexesFor(sourceIndex),
      startY: event.clientY,
    };
  };

  const onGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const started = rowDragStart.current;
    const canvas = gridCanvasRef.current;
    if (!started) {
      setIsBorderHover(selectedBorderAt(event.clientX, event.clientY) !== null);
      return;
    }
    if (started.pointerId !== event.pointerId || !canvas || Math.abs(event.clientY - started.startY) < 6) return;
    event.preventDefault();
    event.stopPropagation();
    const targetIndex = rowIndexAt(event.clientY);
    if (targetIndex < 0) { setRowDrag(null); return; }
    const bounds = gridRef.current?.getBounds(0, targetIndex);
    if (!bounds) return;
    const preview = tableRowMovePreview(rows, started.sourceIndex, targetIndex, started.sourceIndexes);
    const canvasBounds = canvas.getBoundingClientRect();
    setRowDrag({
      sourceIndex: started.sourceIndex,
      sourceCount: started.sourceIndexes.length,
      targetIndex,
      valid: preview.valid,
      lineTop: (preview.edge === "bottom" ? bounds.y + bounds.height : bounds.y) - canvasBounds.top,
      ghostTop: Math.max(38, Math.min(canvasBounds.height - 42, event.clientY - canvasBounds.top - 18)),
    });
  };

  const onGridPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const started = rowDragStart.current;
    if (!started || started.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(event.clientY - started.startY) >= 6) {
      const targetIndex = rowIndexAt(event.clientY);
      if (targetIndex >= 0 && tableRowMovePreview(rows, started.sourceIndex, targetIndex, started.sourceIndexes).valid) {
        moveRow(started.sourceIndex, targetIndex, started.sourceIndexes);
      }
    }
    clearRowDrag();
    setIsBorderHover(selectedBorderAt(event.clientX, event.clientY) !== null);
  };

  const clearRowDrag = useCallback(() => {
    rowDragStart.current = null;
    setRowDrag(null);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", clearRowDrag);
    window.addEventListener("pointercancel", clearRowDrag);
    return () => {
      window.removeEventListener("pointerup", clearRowDrag);
      window.removeEventListener("pointercancel", clearRowDrag);
    };
  }, [clearRowDrag]);

  const selectedRowEdges = useMemo(() => {
    const edges = new Map<number, { top: boolean; bottom: boolean }>();
    for (const { start, end } of selectedRowGroups(selectedMarkerRows)) {
      for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
        edges.set(rowIndex, { top: rowIndex === start, bottom: rowIndex === end });
      }
    }
    return edges;
  }, [selectedMarkerRows]);

  const drawSelectedCellBorder = useCallback<NonNullable<React.ComponentProps<typeof DataEditor>["drawCell"]>>(
    ({ ctx, rect, col, row }, drawContent) => {
      drawContent();
      const edges = selectedRowEdges.get(row);
      if (!edges || rowDrag) return;
      ctx.save();
      ctx.strokeStyle = "#2dd4bf";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (edges.top) {
        ctx.moveTo(rect.x, rect.y + 2);
        ctx.lineTo(rect.x + rect.width, rect.y + 2);
      }
      if (edges.bottom) {
        ctx.moveTo(rect.x, rect.y + rect.height - 2);
        ctx.lineTo(rect.x + rect.width, rect.y + rect.height - 2);
      }
      if (col === 0) {
        ctx.moveTo(rect.x + 2, rect.y);
        ctx.lineTo(rect.x + 2, rect.y + rect.height);
      }
      if (col === gridColumns.length - 1) {
        ctx.moveTo(rect.x + rect.width - 2, rect.y);
        ctx.lineTo(rect.x + rect.width - 2, rect.y + rect.height);
      }
      ctx.stroke();
      ctx.restore();
    },
    [gridColumns.length, rowDrag, selectedRowEdges],
  );

  return (
    <div className="glide-requirement-grid">
      <div className="requirement-grid-actions" role="toolbar" aria-label="Review table actions">
        <button
          className="add-link-column"
          type="button"
          onClick={() => { focusNewColumn.current = true; onAddLinkColumn(); }}
          disabled={columnCount >= 100}
          title="Add Link column"
          aria-label="Add Link column"
        >
          <Plus aria-hidden="true" size={15} />
          <span>Link column</span>
        </button>
        <span className="requirement-row-move-hint" role="status">{rowDrag
          ? rowDrag.valid
            ? `Move ${rowDrag.sourceCount} ${rowDrag.sourceCount === 1 ? "row" : "rows"} ${rowDrag.sourceIndex < rowDrag.targetIndex ? "after" : "before"} row ${rowDrag.targetIndex + 1}`
            : "Choose a row outside the selection"
          : moveMessage || "Shift: range · Ctrl/⌘: multi · Drag green border"}</span>
        <button type="button" onClick={() => moveSelectedRows(-1)}
          disabled={adjacentRowIndex(-1) < 0} title="Move selected rows up" aria-label="Move selected rows up">
          <ArrowUp aria-hidden="true" size={15} />
        </button>
        <button type="button" onClick={() => moveSelectedRows(1)}
          disabled={adjacentRowIndex(1) < 0} title="Move selected rows down" aria-label="Move selected rows down">
          <ArrowDown aria-hidden="true" size={15} />
        </button>
      </div>
      <div className={`requirement-grid-canvas${isBorderHover ? " border-grab-hover" : ""}${rowDrag ? " border-grabbing" : ""}`}
        ref={gridCanvasRef} onPointerDownCapture={onGridPointerDown}
        onPointerMoveCapture={onGridPointerMove} onPointerUpCapture={onGridPointerUp}
        onPointerLeave={() => setIsBorderHover(false)}>
      <DataEditor
        ref={gridRef}
        drawFocusRing={selectedMarkerRows.length <= 1}
        columns={gridColumns}
        freezeColumns={2}
        rows={rows.length + 1}
        getCellContent={getCellContent}
        drawCell={drawSelectedCellBorder}
        gridSelection={gridSelection}
        onGridSelectionChange={handleGridSelectionChange}
        onColumnResize={(_, newSize, colIndex) => {
          const id = gridColumns[colIndex]?.id;
          if (id) setColumnWidths((current) => ({ ...current, [String(id)]: newSize }));
        }}
        onHeaderClicked={(column, event) => {
          if (column < 2) return;
          event.preventDefault();
          openColumnColorPicker(column, event.bounds);
        }}
        onHeaderMenuClick={(column, bounds) => openColumnColorPicker(column, bounds)}
        onCellContextMenu={([column, rowIndex], event) => {
          const row = rows[rowIndex];
          if (column !== 1 || row?.kind !== "requirement" || !placedTextCountByRow.get(row.mark.id)) return;
          event.preventDefault();
          onOpenPlacedTextMenu(row.mark.id, event.bounds);
        }}
        minColumnWidth={44}
        maxColumnWidth={420}
        rangeSelect="multi-rect"
        rowSelect="multi"
        rowSelectionMode="auto"
        onPaste={(target, values) => {
          if (target[1] !== rows.length || (target[0] !== 0 && target[0] !== 1)) return false;
          const items = values.map((row) => target[0] === 0
            ? { number: (row[0] ?? "").trim(), title: (row[1] ?? "").trim() }
            : { number: "", title: row.join("\t").trim() },
          ).filter((item) => item.title);
          if (!items.length) return false;
          focusTrailingRow.current = true;
          onAddRequirements(items);
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

          if (!selectedRows.size && selectedCells.size &&
            [...selectedCells.values()].every((columns) => columns.size === 1 && columns.has(1))) {
            const placedRowIds = [...selectedCells.keys()].flatMap((rowIndex) => {
              const row = rows[rowIndex];
              return row?.kind === "requirement" && placedTextCountByRow.get(row.mark.id)
                ? [row.mark.id]
                : [];
            });
            if (placedRowIds.length) {
              onDeletePlacedText(placedRowIds);
              return false;
            }
          }

          if (!selectedRows.size && ![...selectedCells.values()].some((columns) => columns.has(0) || columns.has(1))) {
            const selectedLinks = [...selectedCells].flatMap(([rowIndex, columns]) => {
              const row = rows[rowIndex];
              if (!row) return [];
              return [...columns].flatMap((column) => {
                if (column < 2 || column >= lastLinkColumnExclusive) return [];
                const link = tableLinkAtColumn(row.links, column);
                return link ? [{ row, mark: link.mark, column }] : [];
              });
            });
            if (selectedLinks.length) {
              const highlights = [...new Map(selectedLinks.map(({ mark }) => [mark.id, mark])).values()];
              highlights.forEach(onRemoveHighlight);
              setDeleteNotice(`${highlights.length} PDF highlight${highlights.length === 1 ? "" : "s"} removed with all related links.`);
              if (!isLinkMode && selectedLinks.length === 1 && selectedLinks[0].row.kind === "requirement") {
                const [{ row, column }] = selectedLinks;
                onEvidenceTargetChange(row.mark, column - 1);
              }
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
              `Remove ${selectedUnassignedEvidence.length} unlinked highlight${selectedUnassignedEvidence.length === 1 ? "" : "s"}?`,
            )
          ) {
            selectedUnassignedEvidence.forEach(onRemoveHighlight);
          }
          return false;
        }}
        onCellEdited={([column, rowIndex], value) => {
          if (value.kind !== GridCellKind.Text && value.kind !== GridCellKind.Uri) return;
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
          if ((event.key === "F10" && event.shiftKey) && event.location?.[0] === 1) {
            const row = rows[event.location[1]];
            const bounds = gridRef.current?.getBounds(1, event.location[1]);
            if (row?.kind === "requirement" && placedTextCountByRow.get(row.mark.id) && bounds) {
              onOpenPlacedTextMenu(row.mark.id, bounds);
              event.preventDefault();
              event.cancel();
              return;
            }
          }
          if ((event.key === "Enter" || event.key === " ") && event.location?.[1] === -1 && event.location[0] >= 2) {
            openColumnColorPicker(event.location[0]);
            event.preventDefault();
            event.cancel();
            return;
          }
          if (event.key === "Enter" && event.location && !isLinkMode) {
            const [column, rowIndex] = event.location;
            const row = rows[rowIndex];
            if (column === 1 && row?.kind === "requirement" && placedTextCountByRow.get(row.mark.id)) {
              onJumpToPlacedText(row.mark.id);
              event.preventDefault();
              event.cancel();
              return;
            }
            const target = row && linkTargetForCell(rows, [column, rowIndex], columnCount);
            if (target) {
              setSelectedRow(rowIndex);
              onEvidenceTargetChange(target.mark, column - 1);
              event.preventDefault();
              event.cancel();
              return;
            }
            const link = row && column >= 2 && column < lastLinkColumnExclusive
              ? tableLinkAtColumn(row.links, column)
              : undefined;
            if (link) {
              onJump(link.mark);
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
        rowMarkers={{ kind: "clickable-number", width: 38, theme: { bgCell: "#111827", textDark: "#94a3b8" } }}
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
      {rowDrag ? (
        <>
          {rowDrag.valid ? <div className="requirement-row-drop-line" style={{ top: rowDrag.lineTop }} aria-hidden="true" /> : null}
          <div className={`requirement-row-drag-ghost${rowDrag.valid ? "" : " invalid"}`}
            style={{ top: rowDrag.ghostTop }} aria-hidden="true">
            <span>↕ {rowDrag.sourceCount === 1 ? rowDrag.sourceIndex + 1 : `${rowDrag.sourceCount} rows`}</span>
            <strong>{rows[rowDrag.sourceIndex]?.mark.text}</strong>
          </div>
        </>
      ) : null}
      </div>
      {showStartHint ? (
        <p className="requirement-grid-empty-hint" role="status">
          Add a row to begin reviewing documents.
        </p>
      ) : null}
      {colorPicker ? (
        <div
          ref={colorPickerRef}
          className="link-column-color-menu"
          role="group"
          aria-label={`Color for Link ${colorPicker.column}`}
          style={{ left: colorPicker.left, top: colorPicker.top }}
        >
          <strong>Link {colorPicker.column} color</strong>
          <div className="link-column-color-options">
            {linkColors.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-label={`Link ${colorPicker.column}: ${option.label}`}
                aria-pressed={columnLinkColor(linkColumnColors, colorPicker.column) === option.id}
                onClick={() => {
                  onChangeColumnColor(colorPicker.column, option.id);
                  setColorPicker(null);
                }}
              >
                <span aria-hidden="true" style={{ backgroundColor: option.fill }} />
                {option.label}
              </button>
            ))}
          </div>
          <small>Applies to every cell and PDF highlight in this column.</small>
        </div>
      ) : null}
      {deleteNotice ? <div className="requirement-grid-delete-notice" role="status">{deleteNotice}</div> : null}
    </div>
  );
}
