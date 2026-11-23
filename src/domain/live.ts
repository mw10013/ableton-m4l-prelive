import * as Schema from "effect/Schema";

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
export type ClipRegion = Schema.Schema.Type<typeof ClipRegion>;
export type ReplaceNotesInput = Schema.Schema.Type<typeof ReplaceNotesInput>;
export type ClipIdInput = Schema.Schema.Type<typeof ClipIdInput>;
