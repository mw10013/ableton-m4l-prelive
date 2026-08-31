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

export const Clip = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  end_time: Schema.Number,
  is_arrangement_clip: Schema.Boolean,
  is_midi_clip: Schema.Boolean,
  length: Schema.Number,
  looping: Schema.Boolean,
  name: Schema.String,
  signature_denominator: Schema.Number,
  signature_numerator: Schema.Number,
  start_time: Schema.Number,
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

export const NoteInput = Schema.Struct({
  note_id: Schema.optional(Schema.Number),
  pitch: Schema.Number,
  start_time: Schema.Number,
  duration: Schema.Number,
  velocity: Schema.optional(Schema.Number),
  mute: Schema.optional(Schema.Boolean),
  probability: Schema.optional(Schema.Number),
  velocity_deviation: Schema.optional(Schema.Number),
  release_velocity: Schema.optional(Schema.Number),
});

export const ClipWithNotes = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  path: Schema.String,
  length: Schema.Number,
  is_midi_clip: Schema.Boolean,
  signature_numerator: Schema.Number,
  signature_denominator: Schema.Number,
  notes: Schema.NullOr(Schema.Array(Note)),
});

export const WriteNotesInput = Schema.Struct({
  clipId: Schema.Number,
  newNotes: Schema.Array(NoteInput),
  modifiedNotes: Schema.Array(NoteInput),
  removedNoteIds: Schema.Array(Schema.Number),
});

export type Note = Schema.Schema.Type<typeof Note>;
export type NoteInput = Schema.Schema.Type<typeof NoteInput>;
export type ClipWithNotes = Schema.Schema.Type<typeof ClipWithNotes>;
export type WriteNotesInput = Schema.Schema.Type<typeof WriteNotesInput>;

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
