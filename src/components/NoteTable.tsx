import type { TableColumn } from "@astryxdesign/core/Table";

import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { pixel, Table } from "@astryxdesign/core/Table";

import { type Note } from "@/lib/Domain";

interface NoteTableProps {
  notes: Note[];
  onUpdate: (rowIndex: number, columnId: string, value: unknown) => void;
  onDelete: (rowIndex: number) => void;
}

interface NoteRow extends Record<string, unknown> {
  note_id: number;
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
  mute: boolean;
  rowIndex: number;
}

export function NoteTable({ notes, onUpdate, onDelete }: NoteTableProps) {
  if (notes.length === 0) {
    return (
      <EmptyState
        isCompact
        title="No notes loaded"
        description="Read a clip from Live to edit its notes."
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
  }: {
    key: "pitch" | "start_time" | "duration" | "velocity";
    header: string;
    min?: number;
    max?: number;
    step?: number;
    isIntegerOnly?: boolean;
  }): TableColumn<NoteRow> => ({
    key,
    header,
    width: pixel(104),
    align: "end",
    renderCell: (row) => (
      <NumberInput
        label={header}
        isLabelHidden
        size="sm"
        value={row[key]}
        min={min}
        max={max}
        step={step}
        isIntegerOnly={isIntegerOnly}
        onChange={(value) => {
          onUpdate(row.rowIndex, key, value);
        }}
      />
    ),
  });

  return (
    <Table
      data={notes.map((note, rowIndex): NoteRow => ({ ...note, rowIndex }))}
      idKey="note_id"
      density="compact"
      columns={[
        { key: "note_id", header: "ID", width: pixel(64), align: "end" },
        numberColumn({
          key: "pitch",
          header: "Pitch",
          min: 0,
          max: 127,
          isIntegerOnly: true,
        }),
        numberColumn({ key: "start_time", header: "Start", step: 0.25 }),
        numberColumn({ key: "duration", header: "Dur", step: 0.25 }),
        numberColumn({
          key: "velocity",
          header: "Vel",
          min: 0,
          max: 127,
          isIntegerOnly: true,
        }),
        {
          key: "mute",
          header: "Mute",
          width: pixel(64),
          align: "center",
          renderCell: (row) => (
            <CheckboxInput
              label="Mute"
              isLabelHidden
              size="sm"
              value={row.mute}
              onChange={(checked) => {
                onUpdate(row.rowIndex, "mute", checked);
              }}
            />
          ),
        },
        {
          key: "actions",
          header: "",
          width: pixel(48),
          align: "center",
          resizable: false,
          renderCell: (row) => (
            <IconButton
              label="Delete note"
              variant="ghost"
              size="sm"
              icon={<Icon icon="close" color="inherit" />}
              onClick={() => {
                onDelete(row.rowIndex);
              }}
            />
          ),
        },
      ]}
    />
  );
}
