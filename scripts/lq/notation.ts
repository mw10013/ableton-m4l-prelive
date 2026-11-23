/**
 * A compact text notation for clip notes, so a bar of music costs a few characters.
 *
 * A lane is one string. Steps are `grid` beats long and the lane repeats until `length` beats.
 *
 * Sequence lane, whitespace-separated tokens, `|` ignored:
 *   `.` rest   `-` hold the previous step's notes one more step
 *   `A1`  a note, Ableton octaves (C3 = 60)
 *   `Am7@3`  a chord rooted at octave 3; `Am7@3^1` is its first inversion
 *   `A1+E2`  several notes or chords at once
 *   suffix `!` accents a step, `?` softens it
 *
 * Step lane, one character per step after `<note>:`:
 *   `C1:x...x...`   `x` hit, `X` accent, `o` soft, `.` rest, `-` hold
 */

export interface Note {
  readonly pitch: number;
  readonly start_time: number;
  readonly duration: number;
  readonly velocity: number;
}

export interface LaneOptions {
  readonly grid: number;
  readonly length: number;
  readonly velocity: number;
  readonly gate: number;
}

export class NotationError extends Error {
  override readonly name = "NotationError";
}

const PITCH_CLASS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const CHORD_INTERVALS: Record<string, readonly number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "5": [0, 7],
};

const pitchClass = (letter: string, accidental: string) => {
  const base = PITCH_CLASS[letter.toUpperCase()];
  if (base === undefined) throw new NotationError(`unknown note ${letter}`);
  return base + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
};

const NOTE = /^(?<letter>[A-Ga-g])(?<accidental>[#b]?)(?<octave>-?\d)$/u;
const CHORD =
  /^(?<letter>[A-G])(?<accidental>[#b]?)(?<quality>[a-z0-9]*)@(?<octave>-?\d)(?:\^(?<inversion>\d))?$/u;

/** Ableton names middle C `C3`, so octave `o` starts at MIDI `12 * (o + 2)`. */
export const parsePitch = (text: string): number => {
  const match = NOTE.exec(text);
  if (match === null) {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 0 && n <= 127) return n;
    throw new NotationError(`not a note: ${text}`);
  }
  const [, letter = "", accidental = "", octave = ""] = match;
  return 12 * (Number(octave) + 2) + pitchClass(letter, accidental);
};

const parseChord = (text: string): readonly number[] => {
  const match = CHORD.exec(text);
  if (match === null) throw new NotationError(`not a chord: ${text}`);
  const [, letter = "", accidental = "", quality = "", octave = "", inv] =
    match;
  const intervals = CHORD_INTERVALS[quality];
  if (intervals === undefined)
    throw new NotationError(`unknown chord quality "${quality}" in ${text}`);
  const root = 12 * (Number(octave) + 2) + pitchClass(letter, accidental);
  const pitches = intervals.map((i) => root + i);
  for (let k = 0; k < Number(inv ?? 0); k++) {
    const lowest = pitches.shift();
    if (lowest !== undefined) pitches.push(lowest + 12);
  }
  return pitches;
};

type Step =
  | { readonly kind: "rest" }
  | { readonly kind: "hold" }
  | {
      readonly kind: "play";
      readonly pitches: readonly number[];
      readonly accent: number;
    };

const parseToken = (token: string): Step => {
  if (token === ".") return { kind: "rest" };
  if (token === "-") return { kind: "hold" };
  const accent = token.endsWith("!") ? 20 : token.endsWith("?") ? -25 : 0;
  const body = accent === 0 ? token : token.slice(0, -1);
  const pitches = body
    .split("+")
    .flatMap((part) =>
      part.includes("@") ? parseChord(part) : [parsePitch(part)],
    );
  return { kind: "play", pitches, accent };
};

const STEP_LANE = /^(?<pitch>[^:\s]+):(?<steps>[xXo.-]+)$/u;

const parseSteps = (lane: string): readonly Step[] => {
  const steps = STEP_LANE.exec(lane.replaceAll(/[\s|]/gu, ""));
  if (steps !== null) {
    const pitch = parsePitch(steps.groups?.pitch ?? "");
    return (steps.groups?.steps ?? "").split("").map((c): Step =>
      c === "."
        ? { kind: "rest" }
        : c === "-"
          ? { kind: "hold" }
          : {
              kind: "play",
              pitches: [pitch],
              accent: c === "X" ? 20 : c === "o" ? -30 : 0,
            },
    );
  }
  return lane
    .split(/\s+/u)
    .filter((t) => t !== "" && t !== "|")
    .map(parseToken);
};

const clampVelocity = (v: number) => Math.max(1, Math.min(127, v));

/** The notes of one lane, repeated to fill `length` beats. */
export const parseLane = (
  lane: string,
  options: LaneOptions,
): readonly Note[] => {
  const pattern = parseSteps(lane);
  if (pattern.length === 0) throw new NotationError(`empty lane: ${lane}`);
  const count = Math.round(options.length / options.grid);
  const notes: {
    pitch: number;
    start: number;
    steps: number;
    velocity: number;
  }[] = [];
  let sounding: typeof notes = [];
  for (let i = 0; i < count; i++) {
    const step = pattern[i % pattern.length] ?? { kind: "rest" };
    if (step.kind === "hold") {
      for (const n of sounding) n.steps += 1;
      continue;
    }
    sounding = [];
    if (step.kind === "play") {
      for (const pitch of step.pitches) {
        const n = {
          pitch,
          start: i,
          steps: 1,
          velocity: clampVelocity(options.velocity + step.accent),
        };
        notes.push(n);
        sounding.push(n);
      }
    }
  }
  return notes.map((n) => ({
    pitch: n.pitch,
    start_time: n.start * options.grid,
    duration: Math.max(0.01, (n.steps - (1 - options.gate)) * options.grid),
    velocity: n.velocity,
  }));
};
