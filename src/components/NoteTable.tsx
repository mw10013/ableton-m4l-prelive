import type { TableColumn } from "@astryxdesign/core/Table";

import type { Note } from "@/lib/Domain";

import { useCallback, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
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

export type EditableField = "pitch" | "start_time" | "duration" | "velocity";

export const MIN_DURATION = 1 / 128;

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

const meterUnits = (numerator: number, denominator: number) => ({
  quartersPerBar: (numerator * 4) / denominator,
  quartersPerBeat: 4 / denominator,
});

export const positionLabel = (
  beats: number,
  numerator: number,
  denominator: number,
) => {
  const { quartersPerBar, quartersPerBeat } = meterUnits(
    numerator,
    denominator,
  );
  const bar = Math.floor(beats / quartersPerBar);
  const rem = beats - bar * quartersPerBar;
  const beat = Math.floor(rem / quartersPerBeat);
  const sixteenth = (rem - beat * quartersPerBeat) * 4;
  return `${String(bar + 1)}.${String(beat + 1)}.${trimmed(sixteenth + 1)}`;
};

export const lengthLabel = (
  beats: number,
  numerator: number,
  denominator: number,
) => {
  const { quartersPerBar, quartersPerBeat } = meterUnits(
    numerator,
    denominator,
  );
  const bar = Math.floor(beats / quartersPerBar);
  const rem = beats - bar * quartersPerBar;
  const beat = Math.floor(rem / quartersPerBeat);
  const sixteenth = (rem - beat * quartersPerBeat) * 4;
  return `${String(bar)}.${String(beat)}.${trimmed(sixteenth)}`;
};

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

function NoteNumberCell({
  label,
  value,
  min,
  max,
  step,
  isIntegerOnly,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  isIntegerOnly?: boolean;
  format: (value: number) => string;
  onCommit: (value: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, setPending] = useState<number | undefined>();
  const close = () => {
    setIsEditing(false);
    setPending(undefined);
  };
  const commit = () => {
    if (pending !== undefined && pending !== value) onCommit(pending);
    close();
  };
  return isEditing ? (
    <NumberInput
      label={label}
      isLabelHidden
      size="sm"
      width="100%"
      value={pending ?? value}
      min={min}
      max={max}
      step={step}
      isIntegerOnly={isIntegerOnly}
      hasAutoFocus
      onChange={setPending}
      onEnter={commit}
      onBlur={commit}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") close();
      }}
    />
  ) : (
    <Button
      variant="ghost"
      size="sm"
      label={format(value)}
      tooltip={label}
      onClick={() => {
        setIsEditing(true);
      }}
    />
  );
}

interface NoteTableProps {
  notes: readonly Note[];
  signatureNumerator: number;
  signatureDenominator: number;
  selectedKeys: Set<string>;
  setSelectedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCommitField: (noteId: number, field: EditableField, value: number) => void;
  onToggleMute: (noteId: number, mute: boolean) => void;
}

export function NoteTable({
  notes,
  signatureNumerator,
  signatureDenominator,
  selectedKeys,
  setSelectedKeys,
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

  const numberColumn = ({
    key,
    header,
    min,
    max,
    step,
    isIntegerOnly,
    format,
  }: {
    key: EditableField;
    header: string;
    min: number;
    max?: number;
    step: number;
    isIntegerOnly?: boolean;
    format: (value: number) => string;
  }): TableColumn<NoteRow> => ({
    key,
    header,
    width: pixel(112),
    renderCell: (row) => (
      <NoteNumberCell
        label={`${header} of note ${noteName(row.pitch)} at ${positionLabel(row.start_time, signatureNumerator, signatureDenominator)}`}
        value={row[key]}
        min={min}
        max={max}
        step={step}
        isIntegerOnly={isIntegerOnly}
        format={format}
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
          step: 1,
          isIntegerOnly: true,
          format: noteName,
        }),
        numberColumn({
          key: "start_time",
          header: "Start",
          min: 0,
          step: 0.25,
          format: (value) =>
            positionLabel(value, signatureNumerator, signatureDenominator),
        }),
        numberColumn({
          key: "duration",
          header: "Duration",
          min: MIN_DURATION,
          step: 0.25,
          format: (value) =>
            lengthLabel(value, signatureNumerator, signatureDenominator),
        }),
        numberColumn({
          key: "velocity",
          header: "Velocity",
          min: 0,
          max: 127,
          step: 1,
          isIntegerOnly: true,
          format: trimmed,
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
