import type { TableColumn } from "@astryxdesign/core/Table";

import type { Note } from "@/lib/Domain";

import { useCallback, useState } from "react";

import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import {
  pixel,
  proportional,
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

export type EditableField = "pitch" | "start_time" | "duration" | "velocity";

export { MIN_DURATION };

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

const trimmed = (value: number) => String(Number(value.toFixed(3)));

export const positionLabel = (
  beats: number,
  numerator: number,
  denominator: number,
) => formatBeatTime(beats, { numerator, denominator }, "position");

const extrasLabel = ({
  probability,
  velocity_deviation,
  release_velocity,
}: Note) =>
  [
    probability === 1 ? undefined : `p ${trimmed(probability)}`,
    velocity_deviation === 0 ? undefined : `dev ${trimmed(velocity_deviation)}`,
    release_velocity === 64 ? undefined : `rel ${trimmed(release_velocity)}`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

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
  onCommit: (value: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, setPending] = useState<number | undefined>();
  const shown = pending ?? value;
  const close = () => {
    setIsEditing(false);
    setPending(undefined);
  };
  const commit = () => {
    if (pending !== undefined && pending !== value) onCommit(pending);
    close();
  };
  const scrub = useScrub({
    value: shown,
    min,
    max,
    precision: 0,
    onChange: setPending,
    onCommit: (next) => {
      setPending(undefined);
      if (next !== value) onCommit(next);
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
          setPending(next ?? undefined);
        }}
        onEnter={commit}
        onBlur={commit}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Escape") close();
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
          setPending(Number(event.key));
          setIsEditing(true);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const next = Math.min(
            max,
            Math.max(min, shown + (event.key === "ArrowUp" ? 1 : -1)),
          );
          if (next !== value) onCommit(next);
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
  onCommitField: (noteId: number, field: EditableField, value: number) => void;
  onToggleMute: (noteId: number, mute: boolean) => void;
}

export function NoteTable({
  notes,
  signatureNumerator,
  signatureDenominator,
  selectedKeys,
  setSelectedKeys,
  isDisabled,
  onCommitField,
  onToggleMute,
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
    min,
    max,
    format,
  }: {
    key: "pitch" | "velocity";
    header: string;
    min: number;
    max: number;
    format: (value: number) => string;
  }): TableColumn<NoteRow> => ({
    key,
    header,
    width: pixel(72),
    renderCell: (row) => (
      <NoteNumberCell
        label={`${header} of ${rowLabel(row)}`}
        value={row[key]}
        min={min}
        max={max}
        isDisabled={isDisabled}
        format={format}
        onCommit={(value) => {
          onCommitField(row.note_id, key, value);
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
        onCommit={(value) => {
          onCommitField(row.note_id, key, value);
        }}
      />
    ),
  });

  return (
    <Table
      data={rows}
      idKey={getRowKey}
      density="compact"
      dividers="rows"
      hasHover
      plugins={{ rowIndex: rowIndexPlugin, selection: selectionPlugin }}
      columns={[
        numberColumn({
          key: "pitch",
          header: "Pitch",
          min: 0,
          max: 127,
          format: noteName,
        }),
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
        numberColumn({
          key: "velocity",
          header: "Velocity",
          min: 0,
          max: 127,
          format: String,
        }),
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
        {
          key: "extras",
          header: "More",
          width: proportional(1),
          renderCell: (row) => {
            const label = extrasLabel(row);
            return label === "" ? null : (
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {label}
              </Text>
            );
          },
        },
      ]}
    />
  );
}
