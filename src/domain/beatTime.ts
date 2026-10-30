/**
 * Live's bars . beats . sixteenths notation over a single float in quarter-note beats.
 *
 * Positions are 1-based (`1.1.1` is the first sixteenth of the clip); lengths are 0-based spans
 * (`0.0.2` is two sixteenths). The "sixteenth" segment is always a sixteenth note regardless of meter;
 * in 6/8 a beat is an eighth, so beat runs 1..6 and sixteenth runs 1..2.
 */

export type BeatTimeKind = "position" | "length";

export interface Meter {
  numerator: number;
  denominator: number;
}

export interface MeterUnits {
  quartersPerBar: number;
  quartersPerBeat: number;
}

export const SIXTEENTH = 0.25;
/** Live's smallest note length in beats (1/128 note). */
export const MIN_DURATION = 1 / 128;

export const meterUnits = ({ numerator, denominator }: Meter): MeterUnits => ({
  quartersPerBar: (numerator * 4) / denominator,
  quartersPerBeat: 4 / denominator,
});

export interface BeatTimeSegments {
  bar: number;
  beat: number;
  /** May be fractional for off-grid values. */
  sixteenth: number;
}

const EPSILON = 1e-6;

/** Splits beats into 0-based bar, beat and (possibly fractional) sixteenth. */
export const toSegments = (beats: number, meter: Meter): BeatTimeSegments => {
  const { quartersPerBar, quartersPerBeat } = meterUnits(meter);
  const bar = Math.floor(beats / quartersPerBar + EPSILON);
  const rem = beats - bar * quartersPerBar;
  const beat = Math.floor(rem / quartersPerBeat + EPSILON);
  const sixteenth = (rem - beat * quartersPerBeat) / SIXTEENTH;
  return { bar, beat, sixteenth: Math.max(0, sixteenth) };
};

/** Recomposes 0-based segments into beats. Overflowing segments carry (`1.5.1` in 4/4 is `2.1.1`). */
export const fromSegments = (
  { bar, beat, sixteenth }: BeatTimeSegments,
  meter: Meter,
): number => {
  const { quartersPerBar, quartersPerBeat } = meterUnits(meter);
  return bar * quartersPerBar + beat * quartersPerBeat + sixteenth * SIXTEENTH;
};

const trimmed = (value: number) => String(Number(value.toFixed(4)));

/** True when the value does not sit on a sixteenth. */
export const isOffGrid = (beats: number) =>
  Math.abs(beats / SIXTEENTH - Math.round(beats / SIXTEENTH)) > EPSILON;

export const roundToGrid = (beats: number) =>
  Math.round(beats / SIXTEENTH) * SIXTEENTH;

/**
 * Formats beats as `bar.beat.sixteenth`. `exact` keeps a sub-sixteenth remainder as a decimal on the
 * last segment (`1.1.1.5`); otherwise the value is rounded to the nearest sixteenth, and callers mark
 * inexact values separately (see `isOffGrid`).
 */
export const formatBeatTime = (
  beats: number,
  meter: Meter,
  kind: BeatTimeKind,
  { exact = false }: { exact?: boolean } = {},
): string => {
  const offset = kind === "position" ? 1 : 0;
  const { bar, beat, sixteenth } = toSegments(
    exact ? beats : roundToGrid(beats),
    meter,
  );
  const last = exact ? trimmed(sixteenth + offset) : String(sixteenth + offset);
  return `${String(bar + offset)}.${String(beat + offset)}.${last}`;
};

/** Formatted segments of `formatBeatTime` with their character ranges in the text. */
export const segmentRanges = (text: string) => {
  const ranges: { start: number; end: number }[] = [];
  const pattern = /[^.,\s]+/g;
  let match = pattern.exec(text);
  let count = 0;
  while (match !== null && count < 3) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
    count += 1;
    match = pattern.exec(text);
  }
  return ranges;
};

const PATTERN = /^\s*(\d+)(?:[.,\s]+(\d+))?(?:[.,\s]+(\d+(?:\.\d+)?))?\s*$/;

/**
 * Parses Live/Logic-style typed input. Segments may be separated by `.`, `,` or spaces; trailing
 * segments may be omitted (`3` is bar 3, `3.2` is bar 3 beat 2). Missing segments default to the
 * first sixteenth for positions and zero for lengths. Overflow carries. Returns null when the text
 * is not a bar.beat.sixteenth value.
 */
export const parseBeatTime = (
  text: string,
  meter: Meter,
  kind: BeatTimeKind,
): number | null => {
  const match = PATTERN.exec(text);
  if (match === null) return null;
  const offset = kind === "position" ? 1 : 0;
  const [, barText, beatText, sixteenthText] = match;
  const bar = Number(barText) - offset;
  const beat = beatText === undefined ? 0 : Number(beatText) - offset;
  const sixteenth =
    sixteenthText === undefined ? 0 : Number(sixteenthText) - offset;
  if (bar < 0 || beat < 0 || sixteenth < 0) return null;
  return fromSegments({ bar, beat, sixteenth }, meter);
};
