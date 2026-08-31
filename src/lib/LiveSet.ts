import { Effect, Schema } from "effect";

import * as Domain from "@/lib/Domain";
import { LiveQL } from "@/lib/LiveQL";

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
        id name path length is_midi_clip
        signature_numerator signature_denominator
        notes { note_id pitch start_time duration velocity mute probability velocity_deviation release_velocity }
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
              id path end_time is_arrangement_clip is_midi_clip length looping name
              signature_denominator signature_numerator start_time
            }
          }
          tracks {
            id path has_midi_input name
            clip_slots {
              id path has_clip
              clip {
                id path end_time is_arrangement_clip is_midi_clip length looping name
                signature_denominator signature_numerator start_time
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
              id name path length is_midi_clip
              signature_numerator signature_denominator
              notes { note_id pitch start_time duration velocity mute probability velocity_deviation release_velocity }
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

const AddNotesData = Schema.Struct({
  clip_add_new_notes: Schema.Struct({ id: Schema.Number }),
});

const ModifyNotesData = Schema.Struct({
  clip_apply_note_modifications: Schema.Struct({ id: Schema.Number }),
});

const RemoveNotesData = Schema.Struct({
  clip_remove_notes_by_id: Schema.Struct({ id: Schema.Number }),
});

export const writeNotes = Effect.fn("LiveSet.writeNotes")(function* (
  input: Domain.WriteNotesInput,
) {
  const { gqlDecode } = yield* LiveQL;
  if (input.newNotes.length > 0) {
    yield* gqlDecode(
      AddNotesData,
      `mutation($id: Int!, $notes: NotesDictionaryInput!) {
        clip_add_new_notes(id: $id, notes_dictionary: $notes) { id }
      }`,
      { id: input.clipId, notes: { notes: input.newNotes } },
    );
  }
  if (input.modifiedNotes.length > 0) {
    yield* gqlDecode(
      ModifyNotesData,
      `mutation($id: Int!, $notes: NotesDictionaryInput!) {
        clip_apply_note_modifications(id: $id, notes_dictionary: $notes) { id }
      }`,
      { id: input.clipId, notes: { notes: input.modifiedNotes } },
    );
  }
  if (input.removedNoteIds.length > 0) {
    yield* gqlDecode(
      RemoveNotesData,
      `mutation($id: Int!, $ids: [Int!]!) {
        clip_remove_notes_by_id(id: $id, ids: $ids) { id }
      }`,
      { id: input.clipId, ids: input.removedNoteIds },
    );
  }
});
