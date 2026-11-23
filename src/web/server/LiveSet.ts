import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type * as Domain from "#domain/live.ts";
import { LiveQLError } from "#web/errors.ts";

import { LiveQL } from "./LiveQL.ts";
import type * as LiveSetGraphQL from "./liveql/liveSet.graphql.ts";

type NullableKeys<A> = {
  [K in keyof A]-?: null extends A[K] ? K : never;
}[keyof A];

type WithRequired<A, K extends keyof A> = A & {
  readonly [P in K]: NonNullable<A[P]>;
};

const hasFields = <A, K extends keyof A>(
  value: A,
  keys: readonly K[],
): value is WithRequired<A, K> => keys.every((key) => value[key] !== null);

/**
 * LiveQL's schema makes almost every member nullable (a member the LOM object lacks reads as null),
 * so the generated types allow null where prelive needs a value.
 */
const requireFields = <A extends object, const K extends NullableKeys<A>>(
  type: string,
  value: A,
  keys: readonly K[],
): Effect.Effect<WithRequired<A, K>, LiveQLError> => {
  const missing = keys.filter((key) => value[key] === null);
  return hasFields(value, keys)
    ? Effect.succeed(value)
    : Effect.fail(
        new LiveQLError({
          reason: "decode",
          message: `LiveQL returned null for ${missing.map((key) => `${type}.${String(key)}`).join(", ")}`,
          cause: value,
        }),
      );
};

const requireClip = (clip: LiveSetGraphQL.ClipWithNotes | null) =>
  clip === null
    ? Effect.succeed(null)
    : requireFields("Clip", clip, [
        "is_midi_clip",
        "length",
        "looping",
        "loop_start",
        "loop_end",
        "start_marker",
        "end_marker",
        "signature_numerator",
        "signature_denominator",
      ]);

/** Live silently drops a start set past the current end, or an end set before the start, so a growing region writes its end first. */
const markerProperties = (
  { looping, start, end }: Domain.ClipRegion,
  current: { readonly loop_end: number; readonly end_marker: number },
) => {
  const [startItem, endItem, currentEnd] = looping
    ? [{ loop_start: start }, { loop_end: end }, current.loop_end]
    : [{ start_marker: start }, { end_marker: end }, current.end_marker];
  return end > currentEnd ? [endItem, startItem] : [startItem, endItem];
};

export const readClip = Effect.fn("LiveSet.readClip")(function* () {
  const { live_set } = yield* (yield* LiveQL).execute((client) =>
    client.DetailClip(),
  );
  const { view } = yield* requireFields("Song", live_set, ["view"]);
  return {
    clip: yield* requireClip(view.detail_clip),
    trackName: view.selected_track?.name ?? null,
  };
});

export const readLiveSetOverview = Effect.fn("LiveSet.readLiveSetOverview")(
  function* () {
    const { live_set } = yield* (yield* LiveQL).execute((client) =>
      client.Overview(),
    );
    const { view, tracks } = yield* requireFields("Song", live_set, [
      "view",
      "tracks",
    ]);
    return {
      view,
      tracks: yield* Effect.forEach(tracks, (track) =>
        requireFields("Track", track, ["clip_slots"]),
      ),
    };
  },
);

export const readClipBySlot = Effect.fn("LiveSet.readClipBySlot")(
  function* (input: {
    readonly trackIndex: number;
    readonly slotIndex: number;
  }) {
    const { live_set } = yield* (yield* LiveQL).execute((client) =>
      client.ClipBySlot(input),
    );
    return {
      clip: yield* requireClip(live_set.track?.clip_slot?.clip ?? null),
      trackName: live_set.track?.name ?? null,
    };
  },
);

export const togglePlay = Effect.fn("LiveSet.togglePlay")(function* () {
  const { execute } = yield* LiveQL;
  const { live_set } = yield* execute((client) => client.PlayState());
  if (live_set.is_playing === true) {
    const result = yield* execute((client) =>
      client.StopPlaying({ id: live_set.id }),
    );
    return result.song_stop_playing?.is_playing ?? false;
  }
  const result = yield* execute((client) =>
    client.ContinuePlaying({ id: live_set.id }),
  );
  return result.song_continue_playing?.is_playing ?? true;
});

export const fireClip = Effect.fn("LiveSet.fireClip")(function* (input: {
  readonly clipId: number;
}) {
  const result = yield* (yield* LiveQL).execute((client) =>
    client.FireClip({ id: input.clipId }),
  );
  yield* requireFields("Mutation", result, ["clip_fire"]);
});

export const readClipById = Effect.fn("LiveSet.readClipById")(function* (
  input: Domain.ClipIdInput,
) {
  const { clip } = yield* (yield* LiveQL).execute((client) =>
    client.ClipById({ id: input.clipId }),
  );
  return { clip: yield* requireClip(clip) };
});

/**
 * A whole-clip rewrite done with one-LOM-call mutations only, so the
 * sequence of Live Object Model operations is visible here rather than
 * hidden in a LiveQL composite. Four phases, in order:
 *
 * 1. A fresh read of the clip: the current markers decide the order of the
 *    marker writes, and the current notes decide the deletion window.
 * 2. Markers, one `clip_set` whose list LiveQL applies in order. Live silently drops a start_marker set
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
 * Phases 2-4 are one `ReplaceNotes` mutation, each phase behind an `@include`
 * that is false when it has nothing to do. GraphQL executes mutation fields
 * serially in document order, so the phases keep their order in one round
 * trip, without a composite on the server. Nothing is read back: the caller
 * autowrites the whole list and never merges Live's answer.
 * Not atomic: nothing over the LOM is. A failure leaves the clip in whichever
 * state it reached, and the next write replaces the clip again. Notes added
 * in Live between the read and the delete survive; concurrent editing is
 * unsupported. The elapsed time of the mutation is logged so the client
 * debounce can be tuned from numbers.
 */
export const replaceNotes = Effect.fn("LiveSet.replaceNotes")(function* (
  input: Domain.ReplaceNotesInput,
) {
  const { execute } = yield* LiveQL;
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

  const properties =
    input.region === undefined
      ? undefined
      : markerProperties(input.region, current);

  const starts = (current.get_all_notes_extended?.notes ?? []).map(
    (n) => n.start_time,
  );
  const from_time = Math.min(...starts);
  const removeNotes = starts.length > 0;
  const addNotes = input.notes.length > 0;

  if (properties === undefined && !removeNotes && !addNotes) {
    return { clipId: input.clipId };
  }
  const [elapsed] = yield* execute(
    (client) =>
      client.ReplaceNotes({
        id: input.clipId,
        setMarkers: properties !== undefined,
        properties,
        removeNotes,
        ...(removeNotes && {
          from_time,
          time_span: Math.max(...starts) + 1 - from_time,
        }),
        addNotes,
        notes: input.notes,
      }),
    { timeout: "60 seconds" },
  ).pipe(Effect.timed);
  yield* Effect.logInfo(
    `LiveSet.replaceNotes: clipId=${String(input.clipId)} notes=${String(input.notes.length)}`,
  ).pipe(
    Effect.annotateLogs({
      clipId: input.clipId,
      notes: input.notes.length,
      elapsed: Duration.format(elapsed),
    }),
  );
  return { clipId: input.clipId };
});
