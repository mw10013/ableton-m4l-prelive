import { useEffect, useRef, useState } from "react";

import {
  type ColumnDef,
  columnSizingFeature,
  columnVisibilityFeature,
  metaHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import { type Note as DomainNote } from "@/lib/Domain";

type Note = DomainNote;

interface NoteTableProps {
  notes: Note[];
  onUpdate: (rowIndex: number, columnId: string, value: unknown) => void;
  onDelete: (rowIndex: number) => void;
}

interface NoteTableMeta {
  updateData?: (rowIndex: number, columnId: string, value: unknown) => void;
}

const features = tableFeatures({
  columnSizingFeature,
  columnVisibilityFeature,
  tableMeta: metaHelper<NoteTableMeta>(),
});

function EditableCell({
  getValue,
  row: { index },
  column: { id },
  table,
}: {
  getValue: () => unknown;
  row: { index: number };
  column: { id: string };
  table: {
    options: {
      meta?: { updateData?: (row: number, col: string, val: unknown) => void };
    };
  };
}) {
  const initialValue = getValue();
  const [value, setValue] = useState(String(initialValue));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(String(initialValue));
  }, [initialValue]);

  return (
    <input
      ref={ref}
      type="number"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onBlur={() => {
        const num = Number(value);
        if (!Number.isNaN(num) && String(num) !== String(initialValue)) {
          table.options.meta?.updateData?.(index, id, num);
        }
      }}
      className="w-full bg-transparent px-1 text-right tabular-nums outline-none"
      step={id === "start_time" || id === "duration" ? "0.25" : undefined}
      min={id === "pitch" || id === "velocity" ? "0" : undefined}
      max={id === "pitch" || id === "velocity" ? "127" : undefined}
    />
  );
}

function MuteCell({
  getValue,
  row: { index },
  column: { id },
  table,
}: {
  getValue: () => unknown;
  row: { index: number };
  column: { id: string };
  table: {
    options: {
      meta?: { updateData?: (row: number, col: string, val: unknown) => void };
    };
  };
}) {
  const checked = getValue() as boolean;

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) =>
        table.options.meta?.updateData?.(index, id, e.target.checked)
      }
      className="mx-auto block"
    />
  );
}

const columns: ColumnDef<typeof features, Note>[] = [
  { accessorKey: "note_id", header: "ID", size: 30 },
  { accessorKey: "pitch", header: "Pitch", size: 52, cell: EditableCell },
  { accessorKey: "start_time", header: "Start", size: 52, cell: EditableCell },
  { accessorKey: "duration", header: "Dur", size: 52, cell: EditableCell },
  { accessorKey: "velocity", header: "Vel", size: 56, cell: EditableCell },
  { accessorKey: "mute", header: "Mute", size: 40, cell: MuteCell },
];

const deleteColumn: ColumnDef<typeof features, Note> = {
  id: "delete",
  header: "",
  size: 24,
};

export function NoteTable({ notes, onUpdate, onDelete }: NoteTableProps) {
  const table = useTable({
    features,
    data: notes,
    columns: [
      ...columns,
      {
        ...deleteColumn,
        cell: ({ row: { index } }) => (
          <button
            type="button"
            onClick={() => {
              onDelete(index);
            }}
            className="px-1 text-xs text-muted-foreground hover:text-destructive"
          >
            ✕
          </button>
        ),
      },
    ],
    getRowId: (row) => String(row.note_id),
    meta: { updateData: onUpdate },
  });

  return (
    <table
      className="text-sm"
      style={{ tableLayout: "fixed", width: table.getTotalSize() }}
    >
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th
                key={header.id}
                className="px-1 pb-1 text-left text-xs font-medium text-muted-foreground"
                style={{ width: header.getSize() }}
              >
                <table.FlexRender header={header} />
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} className="border-t border-border">
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="py-0.5">
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
        {notes.length === 0 && (
          <tr>
            <td
              colSpan={columns.length + 1}
              className="py-4 text-center text-xs text-muted-foreground"
            >
              No notes loaded
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
