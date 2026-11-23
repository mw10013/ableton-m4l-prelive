/**
 * A song spec: one JSON file that describes a Set for `lq apply` to converge on, and that
 * `lq dump` writes from Live. Clips are lanes in the notation of `notation.ts`.
 *
 * It covers tempo, scenes, the Arrangement as a scene order, tracks with their devices, the mix,
 * and every Session clip's notes. It does not cover device parameters, a Drum Rack's chains,
 * plug-in patches (`patch` is a note for people) or automation.
 */
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";

/** A lane string, or one with its own grid, gate or base velocity. */
export const LaneSpec = Schema.Union([
  Schema.String,
  Schema.Struct({
    lane: Schema.String,
    grid: Schema.optionalKey(Schema.Finite),
    gate: Schema.optionalKey(Schema.Finite),
    velocity: Schema.optionalKey(Schema.Finite),
  }),
]);

export const ClipSpec = Schema.Struct({
  name: Schema.String,
  length: Schema.Finite,
  grid: Schema.Finite,
  gate: Schema.Finite,
  velocity: Schema.Finite,
  lanes: Schema.Array(LaneSpec),
});
export type ClipSpec = typeof ClipSpec.Type;

export const MixSpec = Schema.Struct({
  /** Decibels as Live writes them, `-10.0 dB`, or a 0..1 knob position. */
  vol: Schema.Union([Schema.String, Schema.Finite]),
  pan: Schema.Finite,
  sends: Schema.Array(Schema.Finite),
});
export type MixSpec = typeof MixSpec.Type;

export const TrackSpec = Schema.Struct({
  name: Schema.String,
  devices: Schema.Array(Schema.String),
  patch: Schema.optionalKey(Schema.String),
  mix: MixSpec,
  /** Session clips by scene name. */
  clips: Schema.Record(Schema.String, ClipSpec),
});
export type TrackSpec = typeof TrackSpec.Type;

export const SongSpec = Schema.Struct({
  tempo: Schema.Finite,
  scenes: Schema.Array(Schema.String),
  /** `Scene:repeats`, as `lq arrange` takes them. */
  arrange: Schema.Array(Schema.String),
  tracks: Schema.Array(TrackSpec),
  returns: Schema.Array(TrackSpec),
});
export type SongSpec = typeof SongSpec.Type;

export const SongSpecJson = Schema.fromJsonString(SongSpec);

/**
 * Lays sections end to end: each `Scene:repeats` takes `repeats` times its longest clip, at
 * least a bar. Returns each placed clip's track, start and Session slot.
 */
export const arrangementOf = (
  arrange: readonly string[],
  scenes: readonly string[],
  clipLengths: (
    slot: number,
  ) => readonly { readonly track: string; readonly length: number }[],
) => {
  const placed: { track: string; start: number; slot: number }[] = [];
  let time = 0;
  for (const section of arrange) {
    const [name = "", repeatText = "1"] = section.split(":");
    const slot = scenes.findIndex(
      (s) => s.toLowerCase() === name.toLowerCase(),
    );
    if (slot === -1) return undefined;
    const clips = clipLengths(slot);
    const length = Math.max(4, ...clips.map((c) => c.length));
    for (let k = 0; k < Number(repeatText); k++) {
      for (const c of clips) placed.push({ track: c.track, start: time, slot });
      time += length;
    }
  }
  return placed;
};

/** Collapses a run of scene slots, one per block, into `Scene:repeats` sections. */
export const sectionsOf = (
  blocks: readonly number[],
  scenes: readonly string[],
) =>
  Arr.isReadonlyArrayNonEmpty(blocks)
    ? Arr.group(blocks).map(
        (run) => `${scenes[run[0]] ?? "?"}:${String(run.length)}`,
      )
    : [];
