import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import * as Domain from "@/lib/Domain";
import { gql } from "@/lib/gql";

export const readClip = createServerFn({ method: "GET" }).handler(async () => {
  return gql(
    `{ live_set { view { selected_track { name } detail_clip {
        id name path length is_midi_clip
        signature_numerator signature_denominator
        notes { note_id pitch start_time duration velocity mute probability velocity_deviation release_velocity }
      } } } }`,
    Schema.Struct({
      live_set: Schema.Struct({
        view: Schema.Struct({
          selected_track: Schema.NullOr(Schema.Struct({ name: Schema.String })),
          detail_clip: Schema.NullOr(Domain.ClipWithNotes),
        }),
      }),
    }),
  );
});

export const readLiveSetOverview = createServerFn({ method: "GET" }).handler(
  async () => {
    return gql(
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
      Schema.Struct({
        live_set: Schema.Struct({
          ...Domain.SongOverview.fields,
          view: Schema.Struct({
            ...Domain.SongView.fields,
            selected_track: Schema.NullOr(Domain.Track),
            detail_clip: Schema.NullOr(Domain.Clip),
          }),
        }),
      }),
    );
  },
);

export const readClipBySlot = createServerFn({ method: "GET" })
  .validator((data: { trackIndex: number; slotIndex: number }) => data)
  .handler(async ({ data: { trackIndex, slotIndex } }) => {
    return gql(
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
      Schema.Struct({
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
      }),
      { trackIndex, slotIndex },
    );
  });

export const togglePlay = createServerFn({ method: "POST" })
  .validator((data: Record<string, never>) => data)
  .handler(async () => {
    const { live_set } = await gql(
      `{ live_set { id is_playing } }`,
      Schema.Struct({
        live_set: Schema.Struct({
          id: Schema.Number,
          is_playing: Schema.Boolean,
        }),
      }),
    );
    if (live_set.is_playing) {
      const result = await gql(
        `mutation($id: Int!) { song_stop_playing(id: $id) { is_playing } }`,
        Schema.Struct({
          song_stop_playing: Schema.NullOr(
            Schema.Struct({ is_playing: Schema.Boolean }),
          ),
        }),
        { id: live_set.id },
      );
      return result.song_stop_playing?.is_playing ?? false;
    }
    const result = await gql(
      `mutation($id: Int!) { song_continue_playing(id: $id) { is_playing } }`,
      Schema.Struct({
        song_continue_playing: Schema.NullOr(
          Schema.Struct({ is_playing: Schema.Boolean }),
        ),
      }),
      { id: live_set.id },
    );
    return result.song_continue_playing?.is_playing ?? true;
  });

export const fireClip = createServerFn({ method: "POST" })
  .validator((data: { clipId: number }) => data)
  .handler(async ({ data: { clipId } }) => {
    await gql(
      `mutation($id: Int!) { clip_fire(id: $id) { id } }`,
      Schema.Struct({ clip_fire: Schema.Struct({ id: Schema.Number }) }),
      { id: clipId },
    );
  });

interface WriteNotesInput {
  clipId: number;
  newNotes: Domain.NoteInput[];
  modifiedNotes: Domain.NoteInput[];
  removedNoteIds: number[];
}

export const writeNotes = createServerFn({ method: "POST" })
  .validator((data: WriteNotesInput) => data)
  .handler(
    async ({ data: { clipId, newNotes, modifiedNotes, removedNoteIds } }) => {
      if (newNotes.length > 0) {
        await gql(
          `mutation($id: Int!, $notes: NotesDictionaryInput!) {
            clip_add_new_notes(id: $id, notes_dictionary: $notes) { id }
          }`,
          Schema.Struct({
            clip_add_new_notes: Schema.Struct({ id: Schema.Number }),
          }),
          { id: clipId, notes: { notes: newNotes } },
        );
      }
      if (modifiedNotes.length > 0) {
        await gql(
          `mutation($id: Int!, $notes: NotesDictionaryInput!) {
            clip_apply_note_modifications(id: $id, notes_dictionary: $notes) { id }
          }`,
          Schema.Struct({
            clip_apply_note_modifications: Schema.Struct({ id: Schema.Number }),
          }),
          { id: clipId, notes: { notes: modifiedNotes } },
        );
      }
      if (removedNoteIds.length > 0) {
        await gql(
          `mutation($id: Int!, $ids: [Int!]!) {
            clip_remove_notes_by_id(id: $id, ids: $ids) { id }
          }`,
          Schema.Struct({
            clip_remove_notes_by_id: Schema.Struct({ id: Schema.Number }),
          }),
          { id: clipId, ids: removedNoteIds },
        );
      }
    },
  );
