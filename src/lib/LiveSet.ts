import { Effect, Schema } from "effect";

import * as Domain from "@/lib/Domain";
import { LiveQL } from "@/lib/LiveQL";

const ClipFields = `
  id path type name color end_time is_arrangement_clip is_session_clip is_midi_clip
  length looping loop_start loop_end start_marker end_marker position muted
  signature_denominator signature_numerator start_time
  view { id path type grid_quantization grid_is_triplet }
`;

const ClipWithNotesFields = `
  ${ClipFields}
  get_all_notes_extended {
    notes { note_id pitch start_time duration velocity mute probability velocity_deviation release_velocity }
  }
`;

const ReadClipData = Schema.Struct({
  live_set: Schema.Struct({
    view: Schema.Struct({
      selected_track: Schema.NullOr(Schema.Struct({ name: Schema.String })),
      detail_clip: Schema.NullOr(Domain.ClipWithNotes),
    }),
  }),
});

export const readClip = Effect.fn("LiveSet.readClip")(function* () {
  const { gqlDecode } = yield* LiveQL;
  return yield* gqlDecode(
    ReadClipData,
    `{ live_set { view { selected_track { name } detail_clip {
        ${ClipWithNotesFields}
      } } } }`,
  );
});

const OverviewData = Schema.Struct({
  live_set: Schema.Struct({
    ...Domain.SongOverview.fields,
    view: Schema.Struct({
      ...Domain.SongView.fields,
      selected_track: Schema.NullOr(Domain.Track),
      detail_clip: Schema.NullOr(Domain.Clip),
    }),
  }),
});

export const readLiveSetOverview = Effect.fn("LiveSet.readLiveSetOverview")(
  function* () {
    const { gqlDecode } = yield* LiveQL;
    return yield* gqlDecode(
      OverviewData,
      `{ live_set {
          id path is_playing
          view {
            id path
            selected_track { id path has_midi_input name }
            detail_clip {
              ${ClipFields}
            }
          }
          tracks {
            id path has_midi_input name
            clip_slots {
              id path has_clip
              clip {
                ${ClipFields}
              }
            }
          }
        } }`,
    );
  },
);

const ClipBySlotData = Schema.Struct({
  live_set: Schema.Struct({
    track: Schema.NullOr(
      Schema.Struct({
        name: Schema.String,
        clip_slot: Schema.NullOr(
          Schema.Struct({
            clip: Schema.NullOr(Domain.ClipWithNotes),
          }),
        ),
      }),
    ),
  }),
});

export const readClipBySlot = Effect.fn("LiveSet.readClipBySlot")(
  function* (input: {
    readonly trackIndex: number;
    readonly slotIndex: number;
  }) {
    const { gqlDecode } = yield* LiveQL;
    return yield* gqlDecode(
      ClipBySlotData,
      `query ($trackIndex: Int!, $slotIndex: Int!) {
      live_set {
        track(index: $trackIndex) {
          name
          clip_slot(index: $slotIndex) {
            clip {
              ${ClipWithNotesFields}
            }
          }
        }
      }
    }`,
      { trackIndex: input.trackIndex, slotIndex: input.slotIndex },
    );
  },
);

const PlayStateData = Schema.Struct({
  live_set: Schema.Struct({
    id: Schema.Number,
    is_playing: Schema.Boolean,
  }),
});

const StopData = Schema.Struct({
  song_stop_playing: Schema.NullOr(
    Schema.Struct({ is_playing: Schema.Boolean }),
  ),
});

const ContinueData = Schema.Struct({
  song_continue_playing: Schema.NullOr(
    Schema.Struct({ is_playing: Schema.Boolean }),
  ),
});

export const togglePlay = Effect.fn("LiveSet.togglePlay")(function* () {
  const { gqlDecode } = yield* LiveQL;
  const { live_set } = yield* gqlDecode(
    PlayStateData,
    `{ live_set { id is_playing } }`,
  );
  if (live_set.is_playing) {
    const result = yield* gqlDecode(
      StopData,
      `mutation($id: Int!) { song_stop_playing(id: $id) { is_playing } }`,
      { id: live_set.id },
    );
    return result.song_stop_playing?.is_playing ?? false;
  }
  const result = yield* gqlDecode(
    ContinueData,
    `mutation($id: Int!) { song_continue_playing(id: $id) { is_playing } }`,
    { id: live_set.id },
  );
  return result.song_continue_playing?.is_playing ?? true;
});

const FireData = Schema.Struct({
  clip_fire: Schema.Struct({ id: Schema.Number }),
});

export const fireClip = Effect.fn("LiveSet.fireClip")(function* (input: {
  readonly clipId: number;
}) {
  yield* (yield* LiveQL).gqlDecode(
    FireData,
    `mutation($id: Int!) { clip_fire(id: $id) { id } }`,
    { id: input.clipId },
  );
});

const ClipByIdData = Schema.Struct({
  clip: Schema.NullOr(Domain.ClipWithNotes),
});

export const readClipById = Effect.fn("LiveSet.readClipById")(function* (
  input: Domain.ClipIdInput,
) {
  return yield* (yield* LiveQL).gqlDecode(
    ClipByIdData,
    `query($id: Int!) { clip(id: $id) { ${ClipWithNotesFields} } }`,
    { id: input.clipId },
  );
});

const ReplaceNotesData = Schema.Struct({
  clip_replace_notes: Domain.ClipWithNotes,
});

const SetClipPropertiesData = Schema.Struct({
  clip_set_properties: Schema.Struct({ id: Schema.Number }),
});

/**
 * Region first, then notes: Live drops a marker that would cross its partner, so
 * a region that has to grow must grow before the notes that need it land.
 * Not atomic, and deliberately so — the region write and the note replacement
 * are separate LOM operations, and any failure leaves the clip in whichever
 * state it reached. The caller treats every failure as unverified and recovers
 * by reloading, never by retrying.
 */
export const replaceNotes = Effect.fn("LiveSet.replaceNotes")(function* (
  input: Domain.ReplaceNotesInput,
) {
  const { gqlDecode } = yield* LiveQL;
  if (input.region !== undefined) {
    const { looping, start, end } = input.region;
    yield* gqlDecode(
      SetClipPropertiesData,
      `mutation($id: Int!, $properties: ClipPropertiesInput!) {
        clip_set_properties(id: $id, properties: $properties) { id }
      }`,
      {
        id: input.clipId,
        properties: looping
          ? { loop_start: start, loop_end: end }
          : { start_marker: start, end_marker: end },
      },
    );
  }
  return yield* gqlDecode(
    ReplaceNotesData,
    `mutation($id: Int!, $notes: [ReplacementNoteInput!]!) {
      clip_replace_notes(id: $id, notes: $notes) { ${ClipWithNotesFields} }
    }`,
    { id: input.clipId, notes: input.notes },
    { timeout: "60 seconds" },
  );
});
