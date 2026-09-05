import type { Note, ReplacementNote } from "@/lib/Domain";

import { MIN_DURATION } from "@/lib/beatTime";
export const TIME_EPSILON = 1e-9;

/**
 * A note as the editor holds it. `id` is minted in the browser from a counter
 * scoped to the loaded clip; Live's `note_id` is read on load and dropped,
 * because a whole-clip write reassigns every id in Live and so it is not a
 * stable identity for anything the table holds.
 */
export interface NoteRow extends ReplacementNote {
  readonly id: number;
}

export const byMusicalOrder = <T extends ReplacementNote>(
  notes: readonly T[],
): readonly T[] =>
  notes.toSorted((a, b) => a.start_time - b.start_time || a.pitch - b.pitch);

/** Rows for a freshly read clip, numbered from `firstId` in musical order. */
export const rowsOf = (
  notes: readonly Note[],
  firstId: number,
): { readonly rows: readonly NoteRow[]; readonly nextId: number } => {
  const rows = byMusicalOrder(notes).map(
    ({ note_id: _noteId, ...fields }, index) => ({
      ...fields,
      id: firstId + index,
    }),
  );
  return { rows, nextId: firstId + rows.length };
};

export const toReplacementNotes = (
  notes: readonly NoteRow[],
): readonly ReplacementNote[] => notes.map(({ id: _id, ...note }) => note);

const REPLACEMENT_FIELDS = [
  "pitch",
  "start_time",
  "duration",
  "velocity",
  "mute",
  "probability",
  "velocity_deviation",
  "release_velocity",
] as const satisfies readonly (keyof ReplacementNote)[];

const sameFields = (x: ReplacementNote, y: ReplacementNote) =>
  REPLACEMENT_FIELDS.every((field) => x[field] === y[field]);

/** Positional comparison of note fields, ignoring ids. Lists are kept in musical order. */
export const sameNotes = (x: readonly NoteRow[], y: readonly NoteRow[]) =>
  x.length === y.length && x.every((row, i) => sameFields(row, y[i]));

/**
 * The first quarter-note boundary at or after the end of the selection. The
 * epsilon matters: a selection ending at a boundary reached by accumulating
 * floats lands a hair above it, and a bare `Math.ceil` would then skip a whole
 * quarter note.
 */
export const defaultDestination = (selected: readonly NoteRow[]): number =>
  Math.ceil(
    Math.max(
      ...selected.map(({ start_time, duration }) => start_time + duration),
    ) - TIME_EPSILON,
  );

export const duplicateNotes = ({
  notes,
  selected,
  destination,
  firstId,
}: {
  readonly notes: readonly NoteRow[];
  readonly selected: readonly NoteRow[];
  readonly destination: number;
  readonly firstId: number;
}): {
  readonly notes: readonly NoteRow[];
  readonly copies: readonly NoteRow[];
  readonly nextId: number;
} => {
  const offset =
    destination - Math.min(...selected.map(({ start_time }) => start_time));
  const copies = selected.map((note, index) => ({
    ...note,
    id: firstId + index,
    start_time: note.start_time + offset,
  }));
  return {
    notes: byMusicalOrder([...notes, ...copies]),
    copies,
    nextId: firstId + copies.length,
  };
};

export const playbackRegion = ({
  looping,
  loop_start,
  loop_end,
  start_marker,
  end_marker,
}: {
  readonly looping: boolean;
  readonly loop_start: number;
  readonly loop_end: number;
  readonly start_marker: number;
  readonly end_marker: number;
}): { readonly start: number; readonly end: number } =>
  looping
    ? { start: loop_start, end: loop_end }
    : { start: start_marker, end: end_marker };

export const quartersPerBar = (numerator: number, denominator: number) =>
  (numerator * 4) / denominator;

/**
 * The region the clip needs in order to play every note, grown outward to a bar
 * so a loop stays musical, and never shrunk — an edit that empties the tail of a
 * clip must not silently crop a region the user set. The epsilons keep a note
 * ending exactly on a bar line from claiming the next bar.
 */
export const requiredPlaybackRegion = ({
  notes,
  region,
  quartersPerBar: bar,
}: {
  readonly notes: readonly ReplacementNote[];
  readonly region: { readonly start: number; readonly end: number };
  readonly quartersPerBar: number;
}): { readonly start: number; readonly end: number } =>
  notes.length === 0
    ? region
    : {
        start: Math.min(
          region.start,
          Math.floor(
            (Math.min(...notes.map(({ start_time }) => start_time)) +
              TIME_EPSILON) /
              bar,
          ) * bar,
        ),
        end: Math.max(
          region.end,
          Math.ceil(
            (Math.max(
              ...notes.map(({ start_time, duration }) => start_time + duration),
            ) -
              TIME_EPSILON) /
              bar,
          ) * bar,
        ),
      };

export const isSameRegion = (
  a: { readonly start: number; readonly end: number },
  b: { readonly start: number; readonly end: number },
) => a.start === b.start && a.end === b.end;

export type EditableField =
  | "pitch"
  | "start_time"
  | "duration"
  | "velocity"
  | "probability"
  | "velocity_deviation"
  | "release_velocity";

export const FIELD_RANGE: Record<
  EditableField,
  { readonly min: number; readonly max: number; readonly isInteger: boolean }
> = {
  pitch: { min: 0, max: 127, isInteger: true },
  start_time: { min: 0, max: Infinity, isInteger: false },
  duration: { min: MIN_DURATION, max: Infinity, isInteger: false },
  velocity: { min: 0, max: 127, isInteger: false },
  probability: { min: 0, max: 1, isInteger: false },
  velocity_deviation: { min: -127, max: 127, isInteger: false },
  release_velocity: { min: 0, max: 127, isInteger: false },
};

export const clampField = (field: EditableField, value: number): number => {
  const { min, max, isInteger } = FIELD_RANGE[field];
  const clamped = Math.min(max, Math.max(min, value));
  return isInteger ? Math.round(clamped) : clamped;
};

/** Every target gets `value`. Cubase: "To set all selected events to the same value, press Ctrl/Cmd". */
export const setField = (
  notes: readonly NoteRow[],
  targetIds: ReadonlySet<number>,
  field: EditableField,
  value: number,
): readonly NoteRow[] =>
  byMusicalOrder(
    notes.map((note) =>
      targetIds.has(note.id)
        ? { ...note, [field]: clampField(field, value) }
        : note,
    ),
  );

/**
 * Every target moves by `delta`, shortened so that no target leaves the field's range: the group
 * stops when its first member reaches a bound, so a transposed chord keeps its voicing and a
 * velocity ramp keeps its slope. This is Logic's plain-drag rule for multi-selections ("parameter
 * values can only be altered until the parameter value of one of the selected events has reached
 * its maximum or minimum value") and Cubase's ("any initial value differences between the events
 * are maintained"). Integer fields round the delta first so every member moves by the same amount.
 */
export const shiftField = (
  notes: readonly NoteRow[],
  targetIds: ReadonlySet<number>,
  field: EditableField,
  delta: number,
): readonly NoteRow[] => {
  const { min, max, isInteger } = FIELD_RANGE[field];
  const values = notes
    .filter((note) => targetIds.has(note.id))
    .map((note) => note[field]);
  const headroom = Math.min(...values.map((value) => max - value));
  const legroom = Math.max(...values.map((value) => min - value));
  const step = Math.max(legroom, Math.min(headroom, delta));
  const applied = isInteger ? Math.round(step) : step;
  return applied === 0
    ? notes
    : byMusicalOrder(
        notes.map((note) =>
          targetIds.has(note.id)
            ? { ...note, [field]: clampField(field, note[field] + applied) }
            : note,
        ),
      );
};
