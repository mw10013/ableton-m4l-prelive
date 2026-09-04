import type { Note, ReplacementNote } from "@/lib/Domain";

import { MIN_DURATION } from "@/lib/beatTime";
export const TIME_EPSILON = 1e-9;

export const byMusicalOrder = (notes: readonly Note[]): readonly Note[] =>
  notes.toSorted((a, b) => a.start_time - b.start_time || a.pitch - b.pitch);

/**
 * Locally added and duplicated notes carry negative ids allocated below every id
 * in the list. They are row identity for the table only: Live never sees them,
 * because `toReplacementNotes` strips every id, and a write hands back notes
 * with fresh Live ids. Derived from the list rather than a module counter so a
 * clip switch cannot collide with ids left over from the previous clip.
 */
export const nextTempId = (notes: readonly Note[]): number =>
  Math.min(0, ...notes.map(({ note_id }) => note_id)) - 1;

export const toReplacementNotes = (
  notes: readonly Note[],
): readonly ReplacementNote[] =>
  notes.map(({ note_id: _noteId, ...note }) => note);

/**
 * The first quarter-note boundary at or after the end of the selection. The
 * epsilon matters: a selection ending at a boundary reached by accumulating
 * floats lands a hair above it, and a bare `Math.ceil` would then skip a whole
 * quarter note.
 */
export const defaultDestination = (selected: readonly Note[]): number =>
  Math.ceil(
    Math.max(
      ...selected.map(({ start_time, duration }) => start_time + duration),
    ) - TIME_EPSILON,
  );

export const duplicateNotes = ({
  notes,
  selected,
  destination,
}: {
  readonly notes: readonly Note[];
  readonly selected: readonly Note[];
  readonly destination: number;
}): { readonly notes: readonly Note[]; readonly copies: readonly Note[] } => {
  const offset =
    destination - Math.min(...selected.map(({ start_time }) => start_time));
  const firstTempId = nextTempId(notes);
  const copies = selected.map((note, index) => ({
    ...note,
    note_id: firstTempId - index,
    start_time: note.start_time + offset,
  }));
  return { notes: byMusicalOrder([...notes, ...copies]), copies };
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
  readonly notes: readonly Note[];
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
  notes: readonly Note[],
  targetIds: ReadonlySet<number>,
  field: EditableField,
  value: number,
): readonly Note[] =>
  byMusicalOrder(
    notes.map((note) =>
      targetIds.has(note.note_id)
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
  notes: readonly Note[],
  targetIds: ReadonlySet<number>,
  field: EditableField,
  delta: number,
): readonly Note[] => {
  const { min, max, isInteger } = FIELD_RANGE[field];
  const values = notes
    .filter((note) => targetIds.has(note.note_id))
    .map((note) => note[field]);
  const headroom = Math.min(...values.map((value) => max - value));
  const legroom = Math.max(...values.map((value) => min - value));
  const step = Math.max(legroom, Math.min(headroom, delta));
  const applied = isInteger ? Math.round(step) : step;
  return applied === 0
    ? notes
    : byMusicalOrder(
        notes.map((note) =>
          targetIds.has(note.note_id)
            ? { ...note, [field]: clampField(field, note[field] + applied) }
            : note,
        ),
      );
};
