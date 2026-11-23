import { describe, expect, it } from "@effect/vitest";

import { parseLane, parsePitch } from "#scripts/lq/notation.ts";

const OPTIONS = { grid: 0.25, length: 1, velocity: 100, gate: 1 };

describe("lq notation", () => {
  it("names middle C C3, as Ableton does", () => {
    expect([
      parsePitch("C3"),
      parsePitch("A1"),
      parsePitch("F#-1"),
      parsePitch("36"),
    ]).toEqual([60, 45, 18, 36]);
  });

  it("holds notes with - and repeats the lane to the clip length", () => {
    expect(parseLane(". A1 - .", { ...OPTIONS, length: 2 })).toEqual([
      { pitch: 45, start_time: 0.25, duration: 0.5, velocity: 100 },
      { pitch: 45, start_time: 1.25, duration: 0.5, velocity: 100 },
    ]);
  });

  it("spells chords with an octave and inversions", () => {
    const pitches = (lane: string) =>
      parseLane(lane, { ...OPTIONS, grid: 1 }).map((n) => n.pitch);
    expect(pitches("Am7@2")).toEqual([57, 60, 64, 67]);
    expect(pitches("C@3^1")).toEqual([64, 67, 72]);
    expect(pitches("A1+Fmaj7@2")).toEqual([45, 53, 57, 60, 64]);
  });

  it("reads step lanes with accents and soft hits", () => {
    expect(parseLane("C1:X.o.", OPTIONS)).toEqual([
      { pitch: 36, start_time: 0, duration: 0.25, velocity: 120 },
      { pitch: 36, start_time: 0.5, duration: 0.25, velocity: 70 },
    ]);
  });

  it("applies the gate to shorten notes", () => {
    expect(
      parseLane("A1 .", { ...OPTIONS, length: 0.5, gate: 0.5 })[0]?.duration,
    ).toBe(0.125);
  });
});
