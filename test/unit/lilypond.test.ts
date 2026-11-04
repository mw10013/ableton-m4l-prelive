import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { quantizeNotes } from "#domain/lilypond/quantizer.ts";
import { notesToLilyPond } from "#domain/lilypond/score.ts";
import type { ReplacementNote } from "#domain/live.ts";

const note = (
  pitch: number,
  start_time: number,
  duration: number,
): ReplacementNote => ({
  pitch,
  start_time,
  duration,
  velocity: 100,
  mute: false,
  probability: 1,
  velocity_deviation: 0,
  release_velocity: 64,
});

describe("quantizeNotes", () => {
  it.effect("snaps a slightly early, slightly short note onto the grid", () =>
    Effect.gen(function* () {
      const [quantized] = yield* quantizeNotes([note(60, 0.98, 0.97)]);
      assert.strictEqual(quantized?.start_time, 1);
      assert.strictEqual(quantized?.duration, 1);
    }),
  );
});

describe("notesToLilyPond", () => {
  it("engraves a C major arpeggio in quarter notes", () => {
    const ly = notesToLilyPond([
      note(60, 0, 1),
      note(64, 1, 1),
      note(67, 2, 1),
      note(72, 3, 1),
    ]);
    assert.include(ly, String.raw`\time 4/4`);
    assert.match(ly, /c'4\s+e'4\s+g'4\s+c''4/u);
  });
});
