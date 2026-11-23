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
 *   suffix `!` accents a step, `?` softens it, `*96` sets its velocity
 *
 * Step lane, one character per step after `<note>:`:
 *   `C1:x...x...`   `x` hit, `X` accent, `o` soft, `.` rest, `-` hold
 */

import * as Arr from "effect/Array";
import * as Num from "effect/Number";

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
      readonly velocity?: number;
    };

const FIXED_VELOCITY = /\*(?<velocity>\d+)$/u;

const parseToken = (token: string): Step => {
  if (token === ".") return { kind: "rest" };
  if (token === "-") return { kind: "hold" };
  const fixed = FIXED_VELOCITY.exec(token);
  const rest = fixed === null ? token : token.slice(0, fixed.index);
  const velocity =
    fixed === null ? undefined : Number(fixed.groups?.velocity ?? 100);
  const accent = rest.endsWith("!") ? 20 : rest.endsWith("?") ? -25 : 0;
  const body = accent === 0 ? rest : rest.slice(0, -1);
  const pitches = body
    .split("+")
    .flatMap((part) =>
      part.includes("@") ? parseChord(part) : [parsePitch(part)],
    );
  return velocity === undefined
    ? { kind: "play", pitches, accent }
    : { kind: "play", pitches, accent, velocity };
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

const clampVelocity = Num.clamp({ minimum: 1, maximum: 127 });

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
          velocity: clampVelocity(
            step.velocity ?? options.velocity + step.accent,
          ),
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

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Ableton's name for a MIDI pitch, with sharps: 60 is `C3`. */
export const pitchName = (pitch: number) =>
  `${NAMES[pitch % 12] ?? "?"}${String(Math.floor(pitch / 12) - 2)}`;

/** A lane with its own grid, gate or base velocity, where they differ from the clip's. */
export interface LaneWithOptions {
  readonly lane: string;
  readonly grid?: number;
  readonly gate?: number;
  readonly velocity?: number;
}

export type Lane = string | LaneWithOptions;

export interface Lanes {
  readonly grid: number;
  readonly gate: number;
  readonly velocity: number;
  readonly lanes: readonly Lane[];
}

const GRIDS = [4, 2, 1, 0.5, 0.25, 0.125, 0.0625] as const;
const EPSILON = 1e-3;
const isMultiple = (value: number, step: number) =>
  Math.abs(value / step - Math.round(value / step)) < EPSILON;

interface Placed {
  readonly pitch: number;
  readonly step: number;
  readonly steps: number;
  readonly velocity: number;
}

interface Fit {
  readonly grid: number;
  readonly gate: number;
  readonly placed: readonly Placed[];
}

/** The grid and gate that place every note, trying the coarsest grid first. */
const fit = (notes: readonly Note[], length: number): Fit | undefined => {
  for (const grid of GRIDS) {
    if (!isMultiple(length, grid)) continue;
    if (!notes.every((n) => isMultiple(n.start_time, grid))) continue;
    // duration = (steps - (1 - gate)) * grid, with one gate for the whole lane.
    const steps = notes.map((n) => Math.ceil(n.duration / grid - EPSILON));
    const gates = notes.map((n, i) => n.duration / grid - (steps[i] ?? 1) + 1);
    const gate = gates[0] ?? 1;
    if (gate > EPSILON && gates.every((g) => Math.abs(g - gate) < EPSILON))
      return {
        grid,
        gate: Math.round(gate * 1000) / 1000,
        placed: notes.map((n, i): Placed => ({
          pitch: n.pitch,
          step: Math.round(n.start_time / grid),
          steps: steps[i] ?? 1,
          velocity: Math.round(n.velocity),
        })),
      };
  }
  return undefined;
};

/** Runs of items with the same key, in key order; each run keeps its input order. */
const runsBy = <T>(
  items: Arr.NonEmptyReadonlyArray<T>,
  key: (item: T) => number,
) =>
  Arr.groupWith(
    Arr.sortWith(items, key, Num.Order),
    (a, b) => key(a) === key(b),
  );

/** The most frequent value; on a tie, the one seen first. */
const mode = (values: Arr.NonEmptyReadonlyArray<number>) => {
  const count = (v: number) => Arr.countBy(values, (x) => x === v);
  return Arr.reduce(Arr.dedupe(values), values[0], (best, v) =>
    count(v) > count(best) ? v : best,
  );
};

/** The shortest repeating pattern of a lane's tokens; lanes repeat to the clip length. */
const shortestPeriod = <T>(tokens: readonly T[]) => {
  for (let p = 1; p < tokens.length; p++)
    if (tokens.length % p === 0 && tokens.every((t, i) => t === tokens[i % p]))
      return tokens.slice(0, p);
  return tokens;
};

const sequenceSuffix = (velocity: number, base: number) => {
  const diff = velocity - base;
  return diff === 0
    ? ""
    : diff === 20
      ? "!"
      : diff === -25
        ? "?"
        : `*${String(velocity)}`;
};

const STEP_CHAR: Record<number, string> = { 0: "x", 20: "X", [-30]: "o" };

/**
 * One sequence lane for these notes, or undefined when they need several: every onset's notes
 * must share a length and a velocity, and a note must end before the next onset.
 */
const sequenceLane = (
  placed: readonly Placed[],
  count: number,
  base: number,
  perBar: number,
): string | undefined => {
  if (!Arr.isReadonlyArrayNonEmpty(placed)) return undefined;
  const tokens: string[] = Arr.replicate(".", count);
  let free = 0;
  for (const group of runsBy(placed, (p) => p.step)) {
    const first = group[0];
    const step = first.step;
    if (step < free) return undefined;
    if (
      !group.every(
        (p) => p.steps === first.steps && p.velocity === first.velocity,
      )
    )
      return undefined;
    tokens[step] =
      group.map((p) => pitchName(p.pitch)).join("+") +
      sequenceSuffix(first.velocity, base);
    for (let k = 1; k < first.steps; k++) tokens[step + k] = "-";
    free = step + first.steps;
  }
  return shortestPeriod(tokens)
    .map((t, i) => (i > 0 && perBar >= 1 && i % perBar === 0 ? `| ${t}` : t))
    .join(" ");
};

/** `C1:x...x...`, when every note of one pitch is one step long with a step-lane accent. */
const stepLane = (
  placed: readonly Placed[],
  count: number,
  base: number,
  perBar: number,
): string | undefined => {
  const first = placed[0];
  if (first === undefined) return undefined;
  const chars: string[] = Arr.replicate(".", count);
  for (const p of placed) {
    const char = STEP_CHAR[p.velocity - base];
    if (p.steps !== 1 || char === undefined) return undefined;
    chars[p.step] = char;
  }
  const pattern = shortestPeriod(chars);
  const bars = Arr.chunksOf(pattern, perBar >= 1 ? perBar : pattern.length);
  return `${pitchName(first.pitch)}:${bars.map((bar) => bar.join("")).join(" ")}`;
};

const laneFor = (
  placed: readonly Placed[],
  count: number,
  base: number,
  perBar: number,
) =>
  stepLane(placed, count, base, perBar) ??
  sequenceLane(placed, count, base, perBar);

/**
 * The lanes that `parseLane` turns back into these notes: the inverse of the notation, for
 * dumping a clip. A clip that fits one lane gets one. Otherwise each pitch gets a lane, as a step
 * lane where every hit is one step long, and a pitch whose notes need another grid or gate than
 * the clip's carries its own. Throws when a pitch fits no lane.
 */
export const toLanes = (notes: readonly Note[], length: number): Lanes => {
  if (!Arr.isReadonlyArrayNonEmpty(notes))
    return { grid: 1, gate: 1, velocity: 100, lanes: [] };
  const base = mode(Arr.map(notes, (n) => Math.round(n.velocity)));
  const whole = fit(notes, length);
  if (whole !== undefined) {
    const count = Math.round(length / whole.grid);
    const perBar = 4 / whole.grid;
    const single = sequenceLane(whole.placed, count, base, perBar);
    if (single !== undefined)
      return {
        grid: whole.grid,
        gate: whole.gate,
        velocity: base,
        lanes: [single],
      };
  }
  const lanes = runsBy(notes, (n) => n.pitch).map((group) => {
    const pitch = group[0].pitch;
    const own = fit(group, length);
    if (own === undefined)
      throw new NotationError(`pitch ${pitchName(pitch)} fits no grid`);
    const count = Math.round(length / own.grid);
    const ownBase = mode(Arr.map(group, (n) => Math.round(n.velocity)));
    const lane = laneFor(own.placed, count, ownBase, 4 / own.grid);
    if (lane === undefined)
      throw new NotationError(`pitch ${pitchName(pitch)} fits no lane`);
    return { lane, grid: own.grid, gate: own.gate, velocity: ownBase };
  });
  // The clip's defaults are the first lane's; other lanes list only what differs.
  const first = lanes[0] ?? { grid: 1, gate: 1, velocity: base };
  return {
    grid: first.grid,
    gate: first.gate,
    velocity: first.velocity,
    lanes: lanes.map((l) => {
      const options = {
        ...(l.grid === first.grid ? {} : { grid: l.grid }),
        ...(l.gate === first.gate ? {} : { gate: l.gate }),
        ...(l.velocity === first.velocity ? {} : { velocity: l.velocity }),
      };
      return Object.keys(options).length === 0
        ? l.lane
        : { lane: l.lane, ...options };
    }),
  };
};

/** The notes of lanes under a clip's defaults, with each lane's own options applied. */
export const parseLanes = (
  lanes: readonly Lane[],
  defaults: LaneOptions,
): readonly Note[] =>
  lanes.flatMap((lane) =>
    typeof lane === "string"
      ? parseLane(lane, defaults)
      : parseLane(lane.lane, {
          ...defaults,
          ...(lane.grid === undefined ? {} : { grid: lane.grid }),
          ...(lane.gate === undefined ? {} : { gate: lane.gate }),
          ...(lane.velocity === undefined ? {} : { velocity: lane.velocity }),
        }),
  );
