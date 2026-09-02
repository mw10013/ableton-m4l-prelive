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

const WriteNotesData = Schema.Struct({
  clip_write_notes: Schema.Struct({
    clip: Schema.Struct({ id: Schema.Number }),
    note_ids: Schema.Array(Schema.Number),
  }),
});

const ClipByIdData = Schema.Struct({
  clip: Domain.ClipWithNotes,
});

export const writeNotes = Effect.fn("LiveSet.writeNotes")(function* (
  input: Domain.WriteNotesInput,
) {
  const { gqlDecode } = yield* LiveQL;
  const { clip_write_notes } = yield* gqlDecode(
    WriteNotesData,
    `mutation($id: Int!, $input: ClipWriteNotesInput!) {
      clip_write_notes(id: $id, input: $input) { clip { id } note_ids }
    }`,
    {
      id: input.clipId,
      input: {
        add_new_notes: input.newNotes,
        apply_note_modifications: input.modifiedNotes,
        remove_notes_by_id: input.removedNoteIds,
      },
    },
  );
  const { clip } = yield* gqlDecode(
    ClipByIdData,
    `query($id: Int!) { clip(id: $id) { ${ClipWithNotesFields} } }`,
    { id: input.clipId },
  );
  return { clip, note_ids: clip_write_notes.note_ids };
});
