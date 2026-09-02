import type { Note, ReplacementNote } from "@/lib/Domain";

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
