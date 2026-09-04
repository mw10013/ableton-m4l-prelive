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

import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import {
  pixel,
  resolveContextActions,
  Table,
  useTableRowIndex,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { colorVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import {
  BarBeatSixteenthInput,
  type CellEditProps,
  type EditEndReason,
} from "@/components/BarBeatSixteenthInput";
import { useScrub } from "@/components/useScrub";
import { formatBeatTime, MIN_DURATION } from "@/lib/beatTime";
import { FIELD_RANGE } from "@/lib/noteEdits";

export type { EditableField };

/** How a committed value applies when the edited row is part of a multi-row selection. */
export type CommitMode = "relative" | "absolute";

/** Live's Chance is a percentage; the LOM stores probability 0..1. */
const PROBABILITY_SCALE = 100;

/** A navigable column. `mute` is the checkbox; the rest are spinbutton fields. */
type Column = EditableField | "mute";

const BASE_COLUMNS: readonly Column[] = [
  "pitch",
  "start_time",
  "duration",
  "velocity",
];
const DETAIL_COLUMNS: readonly Column[] = [
  "mute",
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
  /** Live: "When a note is deactivated it is grayed out and will not be played." */
  mutedRow: {
    opacity: 0.45,
  },
  selectedRow: {
    backgroundColor: colorVars["--color-background-blue"],
  },
  /** Logic's Status column: the one non-editable click target, "to avoid any unintentional parameter alterations". */
  gutter: {
    cursor: "default",
    userSelect: "none",
  },
  checkboxCell: {
    display: "inline-flex",
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
  const handlers = isDisabled
    ? {}
    : scrub.bind({
        step: 1,
        onClick: () => {
          onEditStart();
        },
      });
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
      <Text
        type="supporting"
        color={isDisabled ? "secondary" : "primary"}
        hasTabularNumbers
      >
        {format(shown)}
      </Text>
    </span>
  );
}

interface NoteTableProps {
  notes: readonly Note[];
  signatureNumerator: number;
  signatureDenominator: number;
  selectedKeys: Set<string>;
  setSelectedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  isDisabled: boolean;
  /** Mute, Probability, Velocity Deviation and Release Velocity columns; hidden in the basic view. */
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
 * - Enter, Space, F2 or a digit: open the current cell (handled by the cell).
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
 * Known gap: the Mute checkbox keeps its own Tab stop; Astryx `CheckboxInput` has no `tabIndex`.
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
              xstyle: withStyles(props.xstyle, styles.gutter),
            }
          : props,
      transformBodyRow: (props, item) => {
        const selected = live.current.isSelected(item.note_id);
        const xstyle = withStyles(
          props.xstyle,
          ...(item.mute ? [styles.mutedRow] : []),
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
                const column = state.currentColumn ?? BASE_COLUMNS[0];
                if (column !== undefined)
                  state.setCurrent({ noteId: id, column });
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
            ? withStyles(props.xstyle, styles.gutter)
            : props.xstyle,
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
    format = String,
    scale = 1,
  }: {
    key: Exclude<EditableField, "start_time" | "duration">;
    header: string;
    format?: (value: number) => string;
    /** Display units per stored unit; the cell shows and edits whole display units. */
    scale?: number;
  }): TableColumn<NoteRow> => ({
    key,
    header,
    width: pixel(72),
    renderCell: (row) => (
      <NoteNumberCell
        label={`${header} of ${rowLabel(row)}`}
        value={Math.round(row[key] * scale)}
        min={FIELD_RANGE[key].min * scale}
        max={FIELD_RANGE[key].max * scale}
        isDisabled={isDisabled}
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
    width: pixel(88),
    renderCell: (row) => (
      <BarBeatSixteenthInput
        label={`${header} of ${rowLabel(row)}`}
        value={row[key]}
        kind={kind}
        numerator={signatureNumerator}
        denominator={signatureDenominator}
        min={min}
        isDisabled={isDisabled}
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

  const detailColumns: TableColumn<NoteRow>[] = [
    {
      key: "mute",
      header: "Mute",
      width: pixel(64),
      align: "center",
      renderCell: (row) => {
        const cell = { noteId: row.note_id, column: "mute" as const };
        const props = cellProps(cell);
        return (
          <span
            data-cell={props.cellId}
            {...stylex.props(styles.checkboxCell)}
            onFocus={props.onFocus}
          >
            <CheckboxInput
              label={`Mute note ${noteName(row.pitch)}`}
              isLabelHidden
              size="sm"
              isDisabled={isDisabled}
              value={row.mute}
              onChange={(checked) => {
                onToggleMute(row.note_id, checked);
              }}
            />
          </span>
        );
      },
    },
    numberColumn({
      key: "probability",
      header: "Chance",
      format: (value) => `${String(value)}%`,
      scale: PROBABILITY_SCALE,
    }),
    numberColumn({
      key: "velocity_deviation",
      header: "Vel. dev.",
    }),
    numberColumn({ key: "release_velocity", header: "Release" }),
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
        numberColumn({ key: "pitch", header: "Pitch", format: noteName }),
        timeColumn({
          key: "start_time",
          header: "Start",
          kind: "position",
          min: 0,
        }),
        timeColumn({
          key: "duration",
          header: "Duration",
          kind: "length",
          min: MIN_DURATION,
        }),
        numberColumn({ key: "velocity", header: "Velocity" }),
        ...(showDetails ? detailColumns : []),
      ]}
    />
  );
}
