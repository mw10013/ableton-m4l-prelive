import { Schema } from "effect";

/**
 * Base schemas define scalar fields only for each GraphQL object type.
 * Composed schemas (e.g. SongOverview) spread base `.fields` and add
 * nested object relations per-query. This keeps base schemas flat and
 * reusable while letting each query declare exactly the shape it expects.
 */

export const Song = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  is_playing: Schema.Boolean,
});

export const SongView = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
});

export const Track = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  has_midi_input: Schema.Boolean,
  name: Schema.String,
});

export const ClipSlot = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  has_clip: Schema.Boolean,
});

export const ClipView = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  type: Schema.String,
  grid_quantization: Schema.Number,
  grid_is_triplet: Schema.Boolean,
});

/**
 * A Live clip as LiveQL returns it.
 *
 * Session clips and Arrangement clips are the same LOM class and are
 * interchangeable for everything Prelive does: notes, markers, loop, time
 * signature, and scale all live on the clip and mean the same thing in both
 * views. Note `start_time`s are clip-relative beats where 0 is the clip's bar
 * 1.1.1, regardless of where the clip sits in the Arrangement. Do not branch
 * on `is_arrangement_clip` / `is_session_clip` for note editing or display.
 *
 * The only members whose meaning differs by kind are the clip's own
 * `start_time` and `end_time` (Arrangement position versus last launch time),
 * and Prelive does not use them; the playback region comes from
 * `start_marker`, `end_marker`, `loop_start`, `loop_end`, and `looping`.
 * See docs/note-list-editor-clip-context-research.md.
 */
export const Clip = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  type: Schema.String,
  color: Schema.Number,
  end_time: Schema.Number,
  is_arrangement_clip: Schema.Boolean,
  is_session_clip: Schema.Boolean,
  is_midi_clip: Schema.Boolean,
  length: Schema.Number,
  looping: Schema.Boolean,
  loop_start: Schema.Number,
  loop_end: Schema.Number,
  start_marker: Schema.Number,
  end_marker: Schema.Number,
  position: Schema.Number,
  muted: Schema.Boolean,
  name: Schema.String,
  signature_denominator: Schema.Number,
  signature_numerator: Schema.Number,
  start_time: Schema.Number,
  view: ClipView,
});

export const Note = Schema.Struct({
  note_id: Schema.Number,
  pitch: Schema.Number,
  start_time: Schema.Number,
  duration: Schema.Number,
  velocity: Schema.Number,
  mute: Schema.Boolean,
  probability: Schema.Number,
  velocity_deviation: Schema.Number,
  release_velocity: Schema.Number,
});

export const ReplacementNote = Schema.Struct({
  pitch: Schema.Number,
  start_time: Schema.Number,
  duration: Schema.Number,
  velocity: Schema.Number,
  mute: Schema.Boolean,
  probability: Schema.Number,
  velocity_deviation: Schema.Number,
  release_velocity: Schema.Number,
});

export const ClipWithNotes = Schema.Struct({
  ...Clip.fields,
  get_all_notes_extended: Schema.NullOr(
    Schema.Struct({ notes: Schema.Array(Note) }),
  ),
});

export const ClipRegion = Schema.Struct({
  looping: Schema.Boolean,
  start: Schema.Number,
  end: Schema.Number,
});

export const ReplaceNotesInput = Schema.Struct({
  clipId: Schema.Number,
  notes: Schema.Array(ReplacementNote),
  region: Schema.optional(ClipRegion),
});

export const ClipIdInput = Schema.Struct({ clipId: Schema.Number });

export type Note = Schema.Schema.Type<typeof Note>;
export type ReplacementNote = Schema.Schema.Type<typeof ReplacementNote>;
export type ClipWithNotes = Schema.Schema.Type<typeof ClipWithNotes>;
export type ClipRegion = Schema.Schema.Type<typeof ClipRegion>;
export type ReplaceNotesInput = Schema.Schema.Type<typeof ReplaceNotesInput>;
export type ClipIdInput = Schema.Schema.Type<typeof ClipIdInput>;

export const SongOverview = Schema.Struct({
  ...Song.fields,
  tracks: Schema.Array(
    Schema.Struct({
      ...Track.fields,
      clip_slots: Schema.Array(
        Schema.Struct({
          ...ClipSlot.fields,
          clip: Schema.NullOr(Clip),
        }),
      ),
    }),
  ),
});
