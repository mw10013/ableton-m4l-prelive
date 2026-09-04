import type {
  BodyRowRenderProps,
  TableColumn,
  TableContextAction,
  TablePlugin,
} from "@astryxdesign/core/Table";

import type { Note } from "@/lib/Domain";
import type { EditableField } from "@/lib/noteEdits";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { EmptyState } from "@astryxdesign/core/EmptyState";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import {
  pixel,
  proportional,
  resolveContextActions,
  Table,
  useTableRowIndex,
} from "@astryxdesign/core/Table";
import {
  colorVars,
  spacingVars,
  typeScaleVars,
} from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import {
  BarBeatSixteenthInput,
  type CellEditProps,
  type EditEndReason,
} from "@/components/BarBeatSixteenthInput";
import { useDoubleClick } from "@/components/useDoubleClick";
import { useScrub } from "@/components/useScrub";
import { formatBeatTime, MIN_DURATION } from "@/lib/beatTime";
import { FIELD_RANGE } from "@/lib/noteEdits";

export type { EditableField };

/** How a committed value applies when the edited row is part of a multi-row selection. */
export type CommitMode = "relative" | "absolute";

/** Live's Chance is a percentage; the LOM stores probability 0..1. */
const PROBABILITY_SCALE = 100;

/** A navigable column. `mute` is the letter toggle; the rest are spinbutton fields. */
type Column = EditableField | "mute";

/**
 * Logic's Event List order (M, Position, Num, Val, Length) with the Live-only fields after it. Start
 * leads because the list is sorted by it; Length is last because its ragged sixteenth wants the edge.
 */
/** Where a gutter click parks focus when no column is current: Start, not the blank M cell. */
const DEFAULT_COLUMN: Column = "start_time";
const BASE_COLUMNS: readonly Column[] = [
  "mute",
  "start_time",
  "pitch",
  "velocity",
  "duration",
];
const DETAIL_COLUMNS: readonly Column[] = [
  "probability",
  "velocity_deviation",
  "release_velocity",
];

/** The current cell, addressed by note id so it survives the re-sort after a Start edit. */
interface CellRef {
  readonly noteId: number;
  readonly column: Column;
}

const cellId = ({ noteId, column }: CellRef) => `${String(noteId)}:${column}`;

type XStyle = BodyRowRenderProps["xstyle"];

/** Astryx types `xstyle` as `any[]`, which the lint's unsafe-spread rule cannot see through. */
const withStyles = (base: XStyle, ...extra: XStyle): XStyle =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return
  [...base, ...extra];

const styles = stylex.create({
  rest: {
    display: "inline-block",
    cursor: "ns-resize",
    userSelect: "none",
    borderRadius: 2,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${colorVars["--color-accent"]}`,
    },
    outlineOffset: 1,
  },
  /** A toggle button drawn as plain text: Logic's M column has no box, just the letter. */
  muteCell: {
    cursor: "default",
    minWidth: "1ch",
    width: "100%",
    background: "none",
    borderWidth: 0,
    padding: 0,
    fontFamily: "inherit",
    lineHeight: "inherit",
  },
  selectedRow: {
    backgroundColor: colorVars["--color-background-blue"],
  },
  /** Logic's Status column: the one non-editable click target, "to avoid any unintentional parameter alterations". */
  gutter: {
    cursor: "default",
    userSelect: "none",
  },
  /**
   * The one styling override in this table, scoped to its cells. Astryx compact density plus
   * `Text`'s 20 px leading lands rows at 36 px; Logic's list is about 20 px. Body cells own a
   * context menu, so Astryx moves their padding onto the right-click trigger wrapper (4 px block,
   * 8 px inline) where `xstyle` cannot reach it; zeroing the `<td>` padding leaves that alone and
   * gives 24 px rows. Headers have no trigger, so they keep a small padding that lines up with it.
   */
  denseBodyCell: {
    paddingBlock: 0,
    paddingInline: 0,
    fontSize: typeScaleVars["--text-supporting-size"],
    lineHeight: 1.25,
  },
  denseHeaderCell: {
    paddingBlock: spacingVars["--spacing-0-5"],
    paddingInline: spacingVars["--spacing-2"],
    lineHeight: 1.25,
    fontSize: typeScaleVars["--text-supporting-size"],
  },
});

/**
 * Rest-state cell text. Astryx `Text` carries its own 20 px leading, which would defeat `denseCell`,
 * so cells set the supporting size and tabular figures directly.
 */
export const cellTextStyles = stylex.create({
  base: {
    fontSize: typeScaleVars["--text-supporting-size"],
    fontVariantNumeric: "tabular-nums",
    color: colorVars["--color-text-primary"],
  },
  /** Live: "When a note is deactivated it is grayed out"; also the disabled state. */
  secondary: {
    color: colorVars["--color-text-secondary"],
  },
});

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const noteName = (pitch: number) =>
  `${NOTE_NAMES[pitch % 12]}${String(Math.floor(pitch / 12) - 2)}`;

export const positionLabel = (
  beats: number,
  numerator: number,
  denominator: number,
) => formatBeatTime(beats, { numerator, denominator }, "position");

interface NoteRow extends Record<string, unknown> {
  note_id: number;
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
  mute: boolean;
  probability: number;
  velocity_deviation: number;
  release_velocity: number;
}

/**
 * Integer note field (pitch, velocity, chance...). Rest state is tabular text that scrubs
 * vertically.
 *
 * Rest-state pointer: a single click only focuses the cell (so Shift+arrows extend the selection
 * from anywhere in a row); double-click opens the editor, as Logic's "double-click the value".
 * Rest-state keys: Enter, Space or F2 open the editor; a digit opens it with that digit typed;
 * Alt+Up/Down step by one in place. Plain arrows bubble to the table for cell navigation.
 *
 * Editor keys: Enter commits and stays (Cmd/Ctrl+Enter commits as absolute for a multi-selection);
 * Tab / Shift+Tab commit and open the next / previous cell; Escape cancels; blur commits.
 */
function NoteNumberCell({
  label,
  value,
  min,
  max,
  isDisabled,
  isMuted,
  format,
  onCommit,
  isCurrent,
  isEditing,
  editInitial,
  onEditStart,
  onEditEnd,
  onFocus,
  cellId: id,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  isDisabled: boolean;
  isMuted: boolean;
  format: (value: number) => string;
  onCommit: (value: number, mode: CommitMode) => void;
} & CellEditProps) {
  const [pending, setPending] = useState<number | undefined>();
  // Astryx `NumberInput` parses and emits on the same keydown that reaches `onKeyDown`, before React
  // re-renders, so Enter must read the latest value from a ref rather than the render's `pending`.
  const pendingRef = useRef<number | null>(null);
  const setPendingValue = (next: number | undefined) => {
    pendingRef.current = next ?? null;
    setPending(next);
  };
  const isOpen = isEditing && !isDisabled;
  useEffect(() => {
    if (isOpen)
      setPendingValue(
        editInitial === undefined ? undefined : Number(editInitial),
      );
    // Only the open transition seeds the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const shown = pending ?? value;
  const close = (reason: EditEndReason) => {
    setPendingValue(undefined);
    onEditEnd(reason);
  };
  const commit = (reason: EditEndReason, isMetaHeld: boolean) => {
    const next = pendingRef.current;
    if (next !== null && next !== value)
      onCommit(next, isMetaHeld ? "absolute" : "relative");
    close(reason);
  };
  const onClick = useDoubleClick(
    (event) => {
      event.currentTarget.focus();
    },
    () => {
      onEditStart();
    },
  );
  const scrub = useScrub({
    value: shown,
    min,
    max,
    precision: 0,
    onChange: setPendingValue,
    onCommit: (next, { isMetaHeld }) => {
      setPendingValue(undefined);
      if (next !== value) onCommit(next, isMetaHeld ? "absolute" : "relative");
    },
  });
  if (isOpen) {
    return (
      <NumberInput
        label={label}
        isLabelHidden
        size="sm"
        width="100%"
        value={
          pending ?? (editInitial === undefined ? value : Number(editInitial))
        }
        min={min}
        max={max}
        step={1}
        isIntegerOnly
        hasAutoFocus
        onChange={(next) => {
          setPendingValue(next ?? undefined);
        }}
        onBlur={() => {
          commit("blur", false);
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") commit("commit", e.metaKey || e.ctrlKey);
          else if (e.key === "Tab") {
            e.preventDefault();
            commit(e.shiftKey ? "previous" : "next", false);
          } else if (e.key === "Escape") close("cancel");
        }}
      />
    );
  }
  const handlers = isDisabled ? {} : scrub.bind({ step: 1, onClick });
  return (
    <span
      role="spinbutton"
      aria-label={label}
      aria-valuenow={shown}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={format(shown)}
      aria-disabled={isDisabled || undefined}
      tabIndex={!isDisabled && isCurrent ? 0 : -1}
      data-cell={id}
      {...stylex.props(styles.rest)}
      {...handlers}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (isDisabled) return;
        if (event.key === "Enter" || event.key === " " || event.key === "F2") {
          event.preventDefault();
          onEditStart();
        } else if (/^\d$/.test(event.key)) {
          event.preventDefault();
          onEditStart(event.key);
        } else if (
          event.altKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")
        ) {
          event.preventDefault();
          const next = Math.min(
            max,
            Math.max(min, shown + (event.key === "ArrowUp" ? 1 : -1)),
          );
          if (next !== value)
            onCommit(
              next,
              event.metaKey || event.ctrlKey ? "absolute" : "relative",
            );
        }
      }}
    >
      <span
        {...stylex.props(
          cellTextStyles.base,
          (isDisabled || isMuted) && cellTextStyles.secondary,
        )}
      >
        {format(shown)}
      </span>
    </span>
  );
}

/**
 * Logic's M column: blank at rest, the letter when muted, click or Enter/Space toggles. A text cell
 * rather than a checkbox so it shares the roving focus and the row height with the other cells.
 */
function MuteCell({
  label,
  value,
  isDisabled,
  onToggle,
  isCurrent,
  onFocus,
  cellId: id,
}: {
  label: string;
  value: boolean;
  isDisabled: boolean;
  onToggle: (mute: boolean) => void;
} & Pick<CellEditProps, "isCurrent" | "onFocus" | "cellId">) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={value}
      disabled={isDisabled}
      tabIndex={!isDisabled && isCurrent ? 0 : -1}
      data-cell={id}
      {...stylex.props(styles.rest, styles.muteCell, cellTextStyles.base)}
      onFocus={onFocus}
      onClick={() => {
        onToggle(!value);
      }}
    >
      {/* A non-breaking space keeps the empty button clickable at full row height. */}
      {value ? "M" : "\u00A0"}
    </button>
  );
}

interface NoteTableProps {
  notes: readonly Note[];
  signatureNumerator: number;
  signatureDenominator: number;
  selectedKeys: Set<string>;
  setSelectedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  isDisabled: boolean;
  /** Chance, Dev and Rel columns; hidden in the basic view. */
  showDetails: boolean;
  onCommitField: (
    noteId: number,
    field: EditableField,
    value: number,
    mode: CommitMode,
  ) => void;
  onToggleMute: (noteId: number, mute: boolean) => void;
  /** Adds a note after the last row and returns its id; Tab past the last cell calls this. */
  onAddNote: () => number;
  /** Right-click actions for a row; the table adds them after the selection plugin's own. */
  rowActions: (row: Note) => readonly TableContextAction[];
}

/**
 * Editable note grid with keyboard navigation and Finder-style selection.
 *
 * Model (WAI-ARIA grid, with Logic's "navigation is selection" twist): one Tab stop, a roving
 * current cell, and an edit layer entered on purpose. Moving the current row also selects it, as
 * Logic's Left/Right Arrow "select the previous/next event".
 *
 * Navigation layer (no editor open):
 * - Up/Down: move the current row and select only it. Shift+Up/Down: extend the range from the
 *   anchor. Cmd/Ctrl+Up/Down: move without changing the selection.
 * - Left/Right: move across columns. Home/End: first/last column; Cmd/Ctrl+Home/End: first/last row.
 * - Enter, Space, F2, a digit, or a double-click: open the current cell (handled by the cell). A
 *   single click on a value only focuses it, so a click anywhere in a row followed by Shift+arrows
 *   extends the selection instead of stepping a number inside an editor.
 * - Alt+Up/Down: step the current cell's value in place (handled by the cell).
 * - Escape: clear the selection.
 * - Delete/Backspace, Cmd+A, Cmd+D, 0: owned by `NoteListEditor`'s hotkeys.
 *
 * Edit layer: Enter commits and stays; Tab / Shift+Tab commit and open the next / previous cell,
 * wrapping across rows; Tab past the last cell of the last row adds a note and opens its Pitch;
 * Escape cancels; blur commits without moving focus.
 *
 * Pointer selection lives in the row-number gutter, the one non-editable column: click selects one
 * row, Shift-click a range from the anchor, Cmd/Ctrl-click toggles, drag sweeps a range, and the
 * header gutter toggles select all. Clicking a value cell selects its row unless the row is already
 * part of the selection, so a multi-row edit can start from any selected row.
 *
 * Layout follows Logic's Event List (research 2026-09-04): columns sized to their longest value,
 * numbers right-aligned, ~20 px rows, and a single-letter M column instead of a checkbox. Headers use
 * Live's clip-panel words, not the LOM's: "Start" because Live's "Position" means where the loop
 * sits, and "Length" because Live and Logic both say Length for a span while "Duration" is only the
 * LOM property name. Muted rows keep full-strength M and drop the value cells to secondary text
 * rather than dimming the whole row, so the selection band and row number stay legible.
 */
export function NoteTable({
  notes,
  signatureNumerator,
  signatureDenominator,
  selectedKeys,
  setSelectedKeys,
  isDisabled,
  showDetails,
  onCommitField,
  onToggleMute,
  onAddNote,
  rowActions,
}: NoteTableProps) {
  const rows = notes.map((note): NoteRow => ({ ...note }));
  const getRowKey = useCallback((row: NoteRow) => String(row.note_id), []);
  const rowIndexPlugin = useTableRowIndex<NoteRow>({ data: rows, getRowKey });
  const columns: readonly Column[] = showDetails
    ? [...BASE_COLUMNS, ...DETAIL_COLUMNS]
    : BASE_COLUMNS;
  const rowIds = rows.map((row) => row.note_id);

  const [current, setCurrent] = useState<CellRef | null>(null);
  const [editing, setEditing] = useState<{
    readonly cell: CellRef;
    readonly initial?: string;
  } | null>(null);
  /** Selection anchor for Shift ranges and gutter drags. */
  const anchor = useRef<number | null>(null);
  const isDragging = useRef(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  /** Set by keyboard navigation and editor exits; the effect below moves DOM focus once. */
  const focusRequest = useRef(false);
  /** A Tab out of an editor, resolved after the commit's re-render so it sees the re-sorted rows. */
  const pendingMove = useRef<{ from: CellRef; direction: 1 | -1 } | null>(null);
  const [moveTick, setMoveTick] = useState(0);

  const isCurrentValid =
    current !== null &&
    rowIds.includes(current.noteId) &&
    columns.includes(current.column);
  const firstCell: CellRef | null =
    rowIds[0] === undefined || columns[0] === undefined
      ? null
      : { noteId: rowIds[0], column: columns[0] };
  const effectiveCurrent = isCurrentValid ? current : firstCell;

  const isSelected = (noteId: number) => selectedKeys.has(String(noteId));
  const selectOnly = (noteId: number) => {
    setSelectedKeys(new Set([String(noteId)]));
    anchor.current = noteId;
  };
  const selectRange = (fromId: number, toId: number) => {
    const a = rowIds.indexOf(fromId);
    const b = rowIds.indexOf(toId);
    if (a === -1 || b === -1) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelectedKeys(new Set(rowIds.slice(lo, hi + 1).map(String)));
  };
  const toggleSelected = (noteId: number) => {
    setSelectedKeys((keys) => {
      const next = new Set(keys);
      const key = String(noteId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchor.current = noteId;
  };

  const moveTo = (cell: CellRef) => {
    focusRequest.current = true;
    setCurrent(cell);
  };

  /** The cell `direction` steps from `from` in reading order, or null past either end. */
  const neighbour = (from: CellRef, direction: 1 | -1): CellRef | null => {
    const rowIndex = rowIds.indexOf(from.noteId);
    const columnIndex = columns.indexOf(from.column);
    if (rowIndex === -1 || columnIndex === -1) return null;
    let nextColumn = columnIndex + direction;
    let nextRow = rowIndex;
    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    } else if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }
    const noteId = rowIds[nextRow];
    const column = columns[nextColumn];
    return noteId === undefined || column === undefined
      ? null
      : { noteId, column };
  };

  useLayoutEffect(() => {
    const move = pendingMove.current;
    if (move === null) return;
    pendingMove.current = null;
    const next = neighbour(move.from, move.direction);
    if (next !== null) {
      setCurrent(next);
      setEditing({ cell: next });
    } else if (move.direction === 1) {
      const noteId = onAddNote();
      const column = columns[0];
      if (column === undefined) return;
      const cell = { noteId, column };
      setCurrent(cell);
      setEditing({ cell });
      selectOnly(noteId);
    } else {
      focusRequest.current = true;
      setCurrent({ ...move.from });
    }
    // Runs once per Tab out of an editor, after the commit's re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveTick]);

  useEffect(() => {
    if (!focusRequest.current || editing !== null || effectiveCurrent === null)
      return;
    focusRequest.current = false;
    const host = wrapper.current?.querySelector<HTMLElement>(
      `[data-cell="${cellId(effectiveCurrent)}"]`,
    );
    if (host === null || host === undefined) return;
    const target = host.matches("input,[tabindex]")
      ? host
      : host.querySelector<HTMLElement>("input,[tabindex]");
    target?.focus();
    host.scrollIntoView({ block: "nearest" });
  });

  useEffect(() => {
    const stop = () => {
      isDragging.current = false;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const cellProps = (cell: CellRef): CellEditProps => ({
    isCurrent:
      effectiveCurrent !== null &&
      effectiveCurrent.noteId === cell.noteId &&
      effectiveCurrent.column === cell.column,
    isEditing:
      editing !== null &&
      editing.cell.noteId === cell.noteId &&
      editing.cell.column === cell.column,
    editInitial:
      editing !== null && editing.cell.noteId === cell.noteId
        ? editing.initial
        : undefined,
    onEditStart: (initial) => {
      if (isDisabled) return;
      setCurrent(cell);
      setEditing({ cell, initial });
    },
    onEditEnd: (reason) => {
      setEditing(null);
      if (reason === "next" || reason === "previous") {
        pendingMove.current = {
          from: cell,
          direction: reason === "next" ? 1 : -1,
        };
        setMoveTick((tick) => tick + 1);
      } else if (reason !== "blur") {
        focusRequest.current = true;
      }
    },
    onFocus: () => {
      setCurrent((prev) =>
        prev !== null &&
        prev.noteId === cell.noteId &&
        prev.column === cell.column
          ? prev
          : cell,
      );
    },
    cellId: cellId(cell),
  });

  const onWrapperKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isDisabled || editing !== null || effectiveCurrent === null) return;
    if (event.altKey) return;
    const { noteId, column } = effectiveCurrent;
    const rowIndex = rowIds.indexOf(noteId);
    const columnIndex = columns.indexOf(column);
    const isMod = event.metaKey || event.ctrlKey;
    const toRow = (index: number) => {
      const nextId = rowIds[Math.min(rowIds.length - 1, Math.max(0, index))];
      if (nextId === undefined) return;
      if (event.shiftKey) selectRange(anchor.current ?? noteId, nextId);
      else if (!isMod) selectOnly(nextId);
      moveTo({ noteId: nextId, column });
    };
    const toColumn = (index: number) => {
      const next = columns[Math.min(columns.length - 1, Math.max(0, index))];
      if (next !== undefined) moveTo({ noteId, column: next });
    };
    switch (event.key) {
      case "ArrowUp": {
        toRow(rowIndex - 1);
        break;
      }
      case "ArrowDown": {
        toRow(rowIndex + 1);
        break;
      }
      case "ArrowLeft": {
        toColumn(columnIndex - 1);
        break;
      }
      case "ArrowRight": {
        toColumn(columnIndex + 1);
        break;
      }
      case "Home": {
        if (isMod) toRow(0);
        else toColumn(0);
        break;
      }
      case "End": {
        if (isMod) toRow(rowIds.length - 1);
        else toColumn(columns.length - 1);
        break;
      }
      case "Escape": {
        setSelectedKeys(new Set());
        break;
      }
      default: {
        return;
      }
    }
    event.preventDefault();
  };

  // Plugins are memoized once; everything they need comes through refs so rows still see fresh
  // handlers without the Table re-planning its columns every render.
  const selectAll = () => {
    setSelectedKeys((keys) =>
      keys.size === rowIds.length ? new Set() : new Set(rowIds.map(String)),
    );
  };
  const liveState = {
    isDisabled,
    isSelected,
    selectOnly,
    selectRange,
    toggleSelected,
    rowActions,
    currentColumn: effectiveCurrent?.column,
    setCurrent: moveTo,
    selectAll,
  };
  const live = useRef(liveState);
  live.current = liveState;
  const wrapperKeyDown = useRef(onWrapperKeyDown);
  wrapperKeyDown.current = onWrapperKeyDown;

  const notePlugin = useMemo(
    (): TablePlugin<NoteRow> => ({
      transformScrollWrapper: (props) => ({
        ...props,
        htmlProps: {
          ...props.htmlProps,
          ref: wrapper,
          // The cells are the Tab stops; Astryx makes the scroll box one too.
          tabIndex: -1,
          role: "grid",
          "aria-multiselectable": true,
          onKeyDown: (event) => {
            wrapperKeyDown.current(event);
          },
        },
      }),
      transformHeaderCell: (props, column) =>
        column.key === "__rowIndex"
          ? {
              ...props,
              htmlProps: {
                ...props.htmlProps,
                title: "Select all / none",
                onClick: () => {
                  if (!live.current.isDisabled) live.current.selectAll();
                },
              },
              xstyle: withStyles(
                props.xstyle,
                styles.gutter,
                styles.denseHeaderCell,
              ),
            }
          : {
              ...props,
              xstyle: withStyles(props.xstyle, styles.denseHeaderCell),
            },
      transformBodyRow: (props, item) => {
        const selected = live.current.isSelected(item.note_id);
        const xstyle = withStyles(
          props.xstyle,
          ...(selected ? [styles.selectedRow] : []),
        );
        return {
          ...props,
          xstyle,
          htmlProps: {
            ...props.htmlProps,
            role: "row",
            "aria-selected": selected,
            onPointerDown: (event) => {
              const state = live.current;
              if (state.isDisabled || event.button !== 0) return;
              const id = item.note_id;
              const inGutter =
                event.target instanceof Element &&
                event.target.closest("[data-gutter]") !== null;
              if (inGutter) {
                event.preventDefault();
                if (event.shiftKey) state.selectRange(anchor.current ?? id, id);
                else if (event.metaKey || event.ctrlKey)
                  state.toggleSelected(id);
                else {
                  state.selectOnly(id);
                  isDragging.current = true;
                }
                state.setCurrent({
                  noteId: id,
                  column: state.currentColumn ?? DEFAULT_COLUMN,
                });
              } else if (!state.isSelected(id)) {
                state.selectOnly(id);
              }
            },
            onPointerEnter: () => {
              if (isDragging.current && anchor.current !== null)
                live.current.selectRange(anchor.current, item.note_id);
            },
          },
        };
      },
      transformBodyCell: (props, column, item) => ({
        ...props,
        htmlProps:
          column.key === "__rowIndex"
            ? { ...props.htmlProps, "data-gutter": true }
            : { ...props.htmlProps, role: "gridcell" },
        xstyle:
          column.key === "__rowIndex"
            ? withStyles(props.xstyle, styles.gutter, styles.denseBodyCell)
            : withStyles(props.xstyle, styles.denseBodyCell),
        contextMenuActions: () => [
          ...resolveContextActions(props.contextMenuActions),
          ...live.current.rowActions(item),
        ],
      }),
    }),
    [],
  );

  if (notes.length === 0) {
    return (
      <EmptyState
        isCompact
        title="No notes"
        description="This clip has no notes yet — add one from the toolbar."
      />
    );
  }

  const rowLabel = (row: NoteRow) =>
    `note ${noteName(row.pitch)} at ${positionLabel(row.start_time, signatureNumerator, signatureDenominator)}`;

  const numberColumn = ({
    key,
    header,
    label,
    width,
    format = String,
    scale = 1,
  }: {
    key: Exclude<EditableField, "start_time" | "duration">;
    header: string;
    /** Full name for the accessible label when the header is abbreviated. */
    label?: string;
    width: number;
    format?: (value: number) => string;
    /** Display units per stored unit; the cell shows and edits whole display units. */
    scale?: number;
  }): TableColumn<NoteRow> => ({
    key,
    header,
    width: pixel(width),
    align: "end",
    renderCell: (row) => (
      <NoteNumberCell
        label={`${label ?? header} of ${rowLabel(row)}`}
        value={Math.round(row[key] * scale)}
        min={FIELD_RANGE[key].min * scale}
        max={FIELD_RANGE[key].max * scale}
        isDisabled={isDisabled}
        isMuted={row.mute}
        format={format}
        onCommit={(value, mode) => {
          onCommitField(row.note_id, key, value / scale, mode);
        }}
        {...cellProps({ noteId: row.note_id, column: key })}
      />
    ),
  });

  const timeColumn = ({
    key,
    header,
    kind,
    min,
  }: {
    key: "start_time" | "duration";
    header: string;
    kind: "position" | "length";
    min: number;
  }): TableColumn<NoteRow> => ({
    key,
    header,
    width: pixel(72),
    align: "end",
    renderCell: (row) => (
      <BarBeatSixteenthInput
        label={`${header} of ${rowLabel(row)}`}
        value={row[key]}
        kind={kind}
        numerator={signatureNumerator}
        denominator={signatureDenominator}
        min={min}
        isDisabled={isDisabled}
        isMuted={row.mute}
        onCommit={(value, { isMetaHeld }) => {
          onCommitField(
            row.note_id,
            key,
            value,
            isMetaHeld ? "absolute" : "relative",
          );
        }}
        {...cellProps({ noteId: row.note_id, column: key })}
      />
    ),
  });

  const muteColumn: TableColumn<NoteRow> = {
    key: "mute",
    header: "M",
    width: pixel(28),
    align: "center",
    renderCell: (row) => {
      const props = cellProps({ noteId: row.note_id, column: "mute" });
      return (
        <MuteCell
          label={`Mute ${rowLabel(row)}`}
          value={row.mute}
          isDisabled={isDisabled}
          onToggle={(mute) => {
            onToggleMute(row.note_id, mute);
          }}
          isCurrent={props.isCurrent}
          onFocus={props.onFocus}
          cellId={props.cellId}
        />
      );
    },
  };

  const detailColumns: TableColumn<NoteRow>[] = [
    numberColumn({
      key: "probability",
      header: "Chance",
      width: 60,
      format: (value) => `${String(value)}%`,
      scale: PROBABILITY_SCALE,
    }),
    numberColumn({
      key: "velocity_deviation",
      header: "Dev",
      label: "Velocity deviation",
      width: 48,
    }),
    numberColumn({
      key: "release_velocity",
      header: "Rel",
      label: "Release velocity",
      width: 44,
    }),
  ];

  return (
    <Table
      data={rows}
      idKey={getRowKey}
      density="compact"
      dividers="rows"
      hasHover
      plugins={{
        rowIndex: rowIndexPlugin,
        note: notePlugin,
      }}
      columns={[
        muteColumn,
        timeColumn({
          key: "start_time",
          header: "Start",
          kind: "position",
          min: 0,
        }),
        numberColumn({
          key: "pitch",
          header: "Pitch",
          width: 48,
          format: noteName,
        }),
        numberColumn({
          key: "velocity",
          header: "Vel",
          label: "Velocity",
          width: 44,
        }),
        timeColumn({
          key: "duration",
          header: "Length",
          kind: "length",
          min: MIN_DURATION,
        }),
        ...(showDetails ? detailColumns : []),
        // Astryx stretches an all-pixel column set to the table's full width; a proportional filler
        // absorbs the slack so the data columns stay content-sized, as in Logic.
        {
          key: "__filler",
          header: "",
          width: proportional(1, { minWidth: 0 }),
          renderCell: () => null,
        },
      ]}
    />
  );
}
