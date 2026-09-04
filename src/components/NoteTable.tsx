import type {
  TableColumn,
  TableContextAction,
  TablePlugin,
} from "@astryxdesign/core/Table";

import type { Note } from "@/lib/Domain";
import type { EditableField } from "@/lib/noteEdits";

import { useCallback, useMemo, useRef, useState } from "react";

import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import {
  pixel,
  resolveContextActions,
  Table,
  useTableRowIndex,
  useTableSelection,
  useTableSelectionState,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { colorVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import { BarBeatSixteenthInput } from "@/components/BarBeatSixteenthInput";
import { useScrub } from "@/components/useScrub";
import { formatBeatTime, MIN_DURATION } from "@/lib/beatTime";
import { FIELD_RANGE } from "@/lib/noteEdits";

export type { EditableField };

/** How a committed value applies when the edited row is part of a multi-row selection. */
export type CommitMode = "relative" | "absolute";

/** Live's Chance is a percentage; the LOM stores probability 0..1. */
const PROBABILITY_SCALE = 100;

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
 * Integer note field (pitch, velocity). Rest state is tabular text that scrubs vertically; a click,
 * Enter, Space or a typed digit opens a `NumberInput`. Enter and blur commit, Escape cancels.
 */
function NoteNumberCell({
  label,
  value,
  min,
  max,
  isDisabled,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  isDisabled: boolean;
  format: (value: number) => string;
  onCommit: (value: number, mode: CommitMode) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, setPending] = useState<number | undefined>();
  // Astryx `NumberInput` parses and emits on the same keydown that reaches `onKeyDown`, before React
  // re-renders, so Enter must read the latest value from a ref rather than the render's `pending`.
  const pendingRef = useRef<number | null>(null);
  const setPendingValue = (next: number | undefined) => {
    pendingRef.current = next ?? null;
    setPending(next);
  };
  const shown = pending ?? value;
  const close = () => {
    setIsEditing(false);
    setPendingValue(undefined);
  };
  const commit = (isMetaHeld: boolean) => {
    const next = pendingRef.current;
    if (next !== null && next !== value)
      onCommit(next, isMetaHeld ? "absolute" : "relative");
    close();
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
  if (isEditing && !isDisabled) {
    return (
      <NumberInput
        label={label}
        isLabelHidden
        size="sm"
        width="100%"
        value={pending ?? value}
        min={min}
        max={max}
        step={1}
        isIntegerOnly
        hasAutoFocus
        onChange={(next) => {
          setPendingValue(next ?? undefined);
        }}
        onBlur={() => {
          commit(false);
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") commit(e.metaKey || e.ctrlKey);
          else if (e.key === "Escape") close();
        }}
      />
    );
  }
  const handlers = isDisabled
    ? {}
    : scrub.bind({
        step: 1,
        onClick: () => {
          setIsEditing(true);
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
      tabIndex={isDisabled ? -1 : 0}
      {...stylex.props(styles.rest)}
      {...handlers}
      onKeyDown={(event) => {
        if (isDisabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setIsEditing(true);
        } else if (/^\d$/.test(event.key)) {
          event.preventDefault();
          setPendingValue(Number(event.key));
          setIsEditing(true);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
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
  /** Right-click actions for a row; the table adds them after the selection plugin's own. */
  rowActions: (row: Note) => readonly TableContextAction[];
}

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
  rowActions,
}: NoteTableProps) {
  const rows = notes.map((note): NoteRow => ({ ...note }));
  const getRowKey = useCallback((row: NoteRow) => String(row.note_id), []);
  const rowIndexPlugin = useTableRowIndex<NoteRow>({ data: rows, getRowKey });
  const { selectionConfig } = useTableSelectionState<NoteRow>({
    data: rows,
    idKey: getRowKey,
    selectedKeys,
    setSelectedKeys,
  });
  const selectionPlugin = useTableSelection<NoteRow>({
    ...selectionConfig,
    getIsItemEnabled: () => !isDisabled,
    getRowLabel: (row) =>
      `note ${noteName(row.pitch)} at ${positionLabel(row.start_time, signatureNumerator, signatureDenominator)}`,
  });

  const rowActionsRef = useRef(rowActions);
  rowActionsRef.current = rowActions;
  const notePlugin = useMemo(
    (): TablePlugin<NoteRow> => ({
      transformBodyRow: (props, item) => {
        if (!item.mute) return props;
        // Astryx types `xstyle` as `any[]`, which the lint's unsafe-spread rule cannot see through.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const xstyle: typeof props.xstyle = [...props.xstyle, styles.mutedRow];
        return { ...props, xstyle };
      },
      transformBodyCell: (props, _column, item) => ({
        ...props,
        contextMenuActions: () => [
          ...resolveContextActions(props.contextMenuActions),
          ...rowActionsRef.current(item),
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
      />
    ),
  });

  const detailColumns: TableColumn<NoteRow>[] = [
    {
      key: "mute",
      header: "Mute",
      width: pixel(64),
      align: "center",
      renderCell: (row) => (
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
      ),
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
        selection: selectionPlugin,
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
