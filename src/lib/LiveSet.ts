import { Effect, Schema } from "effect";

import * as Domain from "@/lib/Domain";
import { LiveQL, LiveQLError } from "@/lib/LiveQL";

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

/**
 * A whole-clip rewrite done with one-LOM-call mutations only, so the
 * sequence of Live Object Model operations is visible here rather than
 * hidden in a LiveQL composite. Four phases, in order:
 *
 * 1. A fresh read of the clip: the current markers decide the order of the
 *    marker writes, and the current notes decide the deletion window.
 * 2. Markers, one `set` per property. Live silently drops a start_marker set
 *    past the end marker (and an end set before the start), so when the
 *    region grows the end is written before the start, otherwise the start
 *    before the end. loop_start/loop_end for a looping clip,
 *    start_marker/end_marker otherwise. Skipped when the region is unchanged.
 * 3. `remove_notes_extended` over pitches 0-127 and a window from the
 *    earliest onset just read through one beat past the latest. The LOM has
 *    no delete-all; the window is computed from a read because Live can keep
 *    a note at a negative start_time, which a fixed 0..N window would miss.
 * 4. `add_new_notes` with the full list. Every note gets a new note_id.
 *
 * Phases 2-4 go in one GraphQL document as aliased mutation fields, which
 * the spec executes serially in document order; the last field selects the
 * whole clip, so the readback is in the same request and the write is one
 * round trip after the read, without a composite on the server. Not atomic: nothing over the LOM is.
 * A failure leaves the clip in whichever state it reached; the caller
 * treats every failure as unverified and recovers by reloading, never by
 * retrying. Notes added in Live between the read and the delete survive;
 * concurrent editing is unsupported.
 */
export const replaceNotes = Effect.fn("LiveSet.replaceNotes")(function* (
  input: Domain.ReplaceNotesInput,
) {
  const { gqlDecode } = yield* LiveQL;
  const { clip: current } = yield* readClipById({ clipId: input.clipId });
  if (current === null) {
    return yield* Effect.fail(
      new LiveQLError({
        reason: "graphql",
        message: `clip ${String(input.clipId)} no longer exists`,
        cause: undefined,
      }),
    );
  }

  const steps: Step[] = [];

  if (input.region !== undefined) {
    const { looping, start, end } = input.region;
    const [startKey, endKey] = looping
      ? (["loop_start", "loop_end"] as const)
      : (["start_marker", "end_marker"] as const);
    const startStep = {
      field: "clip_set_properties",
      args: { properties: { [startKey]: start } },
    };
    const endStep = {
      field: "clip_set_properties",
      args: { properties: { [endKey]: end } },
    };
    const grows = end > current[endKey];
    steps.push(...(grows ? [endStep, startStep] : [startStep, endStep]));
  }

  const existing = current.get_all_notes_extended?.notes ?? [];
  if (existing.length > 0) {
    const starts = existing.map((n) => n.start_time);
    const from_time = Math.min(...starts);
    steps.push({
      field: "clip_remove_notes_extended",
      args: {
        from_pitch: 0,
        pitch_span: 128,
        from_time,
        time_span: Math.max(...starts) + 1 - from_time,
      },
    });
  }

  if (input.notes.length > 0) {
    steps.push({
      field: "clip_add_new_notes",
      args: { notes: input.notes },
    });
  }

  if (steps.length === 0) {
    return { clip: current };
  }
  const data = yield* gqlDecode(
    Schema.Record(Schema.String, Schema.Unknown),
    mutationDocument(steps),
    Object.fromEntries(
      steps.flatMap((s, i) =>
        Object.entries(s.args).map(([k, v]) => [varName(k, i), v]),
      ),
    ),
    { timeout: "60 seconds" },
  );
  const lastIndex = steps.length - 1;
  const last = data[stepAlias(lastIndex)];
  const clip = yield* Schema.decodeUnknownEffect(Domain.ClipWithNotes)(
    steps.at(lastIndex)?.field === "clip_add_new_notes"
      ? (last as { clip: unknown }).clip
      : last,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new LiveQLError({
          reason: "decode",
          message: "LiveQL response validation failed",
          cause,
        }),
    ),
  );
  return { clip };
});

interface Step {
  readonly field: string;
  readonly args: Record<string, unknown>;
}

const varName = (arg: string, step: number) => `${arg}${String(step)}`;
const stepAlias = (step: number) => `s${String(step)}`;

/**
 * What each field selects. Intermediate steps select the minimum; the last
 * step selects the whole clip so the readback rides in the same request.
 * `clip_add_new_notes` returns a payload with the ids Live assigned and the
 * clip nested under `clip`; the others return the clip itself.
 */
const selection = (field: string, isLast: boolean) => {
  const clip = isLast ? ClipWithNotesFields : "id";
  return field === "clip_add_new_notes"
    ? `{ note_ids clip { ${clip} } }`
    : `{ ${clip} }`;
};

const ARG_TYPES: Record<string, string> = {
  properties: "ClipPropertiesInput!",
  from_pitch: "Int!",
  pitch_span: "Int!",
  from_time: "Float!",
  time_span: "Float!",
  notes: "[NoteInput!]!",
};

/**
 * One mutation document with one aliased root field per step. Variables are
 * suffixed with the step index so the same argument name can appear in
 * several steps. The last field carries the full clip selection, which is the
 * readback: the spec runs mutation fields serially, so it reflects every
 * earlier step.
 */
const mutationDocument = (steps: readonly Step[]) => {
  const vars = ["$id: Int!"];
  const fields: string[] = [];
  steps.forEach((s, i) => {
    const args = ["id: $id"];
    for (const k of Object.keys(s.args)) {
      vars.push(`$${varName(k, i)}: ${ARG_TYPES[k]}`);
      args.push(`${k}: $${varName(k, i)}`);
    }
    fields.push(
      `${stepAlias(i)}: ${s.field}(${args.join(", ")}) ${selection(s.field, i === steps.length - 1)}`,
    );
  });
  return `mutation(${vars.join(", ")}) {\n${fields.join("\n")}\n}`;
};
