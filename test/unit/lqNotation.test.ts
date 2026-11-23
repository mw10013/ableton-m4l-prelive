import { describe, expect, it } from "@effect/vitest";

import {
  type Lane,
  type Note,
  parseLane,
  parseLanes,
  parsePitch,
  pitchName,
  toLanes,
} from "#scripts/lq/notation.ts";

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

  it("names pitches the way it parses them", () => {
    expect([60, 45, 18, 37].map(pitchName)).toEqual([
      "C3",
      "A1",
      "F#-1",
      "C#1",
    ]);
  });

  const notesOf = (
    lanes: readonly Lane[],
    options: { grid: number; gate: number; velocity: number },
    length: number,
  ) =>
    parseLanes(lanes, { ...options, length })
      .map((n) => ({ ...n, duration: Math.round(n.duration * 1000) / 1000 }))
      .toSorted((a, b) => a.start_time - b.start_time || a.pitch - b.pitch);

  const roundTrip = (
    lanes: readonly string[],
    options: { grid: number; gate: number; velocity: number },
    length = 16,
  ) => {
    const notes: readonly Note[] = notesOf(lanes, options, length);
    const dumped = toLanes(notes, length);
    return { notes, again: notesOf(dumped.lanes, dumped, length), dumped };
  };

  it.each([
    [
      "offbeat bass",
      [
        ". A1 . A1 . A1 . A1 | . F1 . F1 . F1 . F1 | . C2 . C2 . C2 . C2 | . G1 . G1 . G1 . G1",
      ],
      { grid: 0.5, gate: 0.9, velocity: 100 },
    ],
    [
      "drums, one step lane per pitch",
      [
        "C1:x...x...x...x...",
        "D#1:....X.......X...",
        "A#1:..x...x...x...x.",
        "F#1:oxo.oxo.oxo.oxoX",
      ],
      { grid: 0.25, gate: 0.9, velocity: 100 },
    ],
    [
      "held chords",
      ["Am7@2 Fmaj7@2 C@3^1 G@2^1"],
      { grid: 4, gate: 1, velocity: 90 },
    ],
    [
      "a lead with holds and accents",
      [
        "E4! - - - C4 - D4 E4 | F4! - - - E4 - C4 - | G4! - - - E4 - D4 C4 | D4! - - - B3 - - .",
      ],
      { grid: 0.5, gate: 0.9, velocity: 105 },
    ],
    [
      "accented and soft notes",
      [
        ". . A1 A2? . . A1 . . . A1 A2? . . A1 A1? | . . F1 F2? . . F1 . . . F1 F2? . . F1 F1?",
      ],
      { grid: 0.25, gate: 0.9, velocity: 100 },
    ],
  ])(
    "turns %s back into lanes that make the same notes",
    (_, lanes, options) => {
      const { notes, again } = roundTrip(lanes, options);
      expect(again).toEqual(notes);
    },
  );

  it("keeps a repeating pattern short, on the coarsest grid that fits", () => {
    const { dumped } = roundTrip(["C1:x...x...x...x..."], {
      grid: 0.25,
      gate: 0.9,
      velocity: 100,
    });
    expect(dumped).toEqual({
      grid: 1,
      gate: 0.225,
      velocity: 100,
      lanes: ["C1"],
    });
  });

  it("dumps notes with any velocity and per-pitch lengths, as the hand-made Groove clips have", () => {
    const beat = (b: number): Note[] => [
      { pitch: 36, start_time: b, duration: 0.25, velocity: 120 },
      { pitch: 42, start_time: b + 0.25, duration: 0.125, velocity: 60 },
      { pitch: 46, start_time: b + 0.5, duration: 0.25, velocity: 90 },
      { pitch: 42, start_time: b + 0.75, duration: 0.125, velocity: 70 },
    ];
    const drums = [0, 1, 2, 3].flatMap(beat);
    const bass = [0, 1, 2, 3].map((b): Note => ({
      pitch: 57,
      start_time: b + 0.5,
      duration: 0.4,
      velocity: b % 2 === 0 ? 110 : 96,
    }));
    for (const notes of [drums, bass]) {
      const dumped = toLanes(notes, 4);
      const sorted = (list: readonly Note[]) =>
        list
          .map((n) => ({
            ...n,
            duration: Math.round(n.duration * 1000) / 1000,
          }))
          .toSorted((a, b) => a.start_time - b.start_time || a.pitch - b.pitch);
      expect(
        sorted(parseLanes(dumped.lanes, { ...dumped, length: 4 })),
      ).toEqual(sorted(notes));
    }
    expect(toLanes(bass, 4).lanes).toEqual([". A2 . A2*96"]);
  });
});
