import type { Note } from "@/lib/Domain";

import { Effect } from "effect";

interface QuantizationConfig {
  readonly startGrid: number;
  readonly startStrongGrids: readonly number[];
  readonly startStrongTolerance: number;
  readonly startGridTolerance: number;
  readonly durationGrid: number;
  readonly durationAllowed: readonly number[];
  readonly durationPreferred: readonly number[];
  readonly durationPreferredTolerance: number;
  readonly durationLongThreshold: number;
  readonly durationToleranceShort: number;
  readonly durationToleranceLong: number;
  readonly dottedValues: readonly number[];
  readonly dottedGrid: number;
  readonly dottedGridTolerance: number;
  readonly endGrid: number;
  readonly endGridTolerance: number;
  readonly endStrongGrid: number;
  readonly endStrongTolerance: number;
  readonly clampToNextOnset: boolean;
  readonly endClampTolerance: number;
  readonly normalizeGrid: number;
}

const defaultQuantizationConfig: QuantizationConfig = {
  startGrid: 1 / 16,
  startStrongGrids: [1 / 4, 1 / 8],
  startStrongTolerance: 1 / 32,
  startGridTolerance: 1 / 64,
  durationGrid: 1 / 16,
  durationAllowed: [
    4,
    3,
    2,
    3 / 2,
    1,
    3 / 4,
    1 / 2,
    3 / 8,
    1 / 4,
    1 / 8,
    1 / 16,
  ],
  durationPreferred: [4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16],
  durationPreferredTolerance: 1 / 6,
  durationLongThreshold: 1,
  durationToleranceShort: 1 / 64,
  durationToleranceLong: 1 / 48,
  dottedValues: [3 / 2, 3 / 4, 3 / 8],
  dottedGrid: 1 / 8,
  dottedGridTolerance: 1 / 64,
  endGrid: 1 / 16,
  endGridTolerance: 1 / 64,
  endStrongGrid: 1 / 4,
  endStrongTolerance: 1 / 8,
  clampToNextOnset: true,
  endClampTolerance: 1 / 8,
  normalizeGrid: 1 / 1024,
};

const roundToGrid = (value: number, grid: number): number =>
  Math.round(value / grid) * grid;

const normalize = (value: number, grid: number): number =>
  roundToGrid(value, grid);

const isClose = (value: number, target: number, tolerance: number): boolean =>
  Math.abs(value - target) <= tolerance;

const snapToGrid = (
  value: number,
  grid: number,
  tolerance: number,
): number | undefined => {
  const snapped = roundToGrid(value, grid);
  return isClose(value, snapped, tolerance) ? snapped : undefined;
};

const isAligned = (value: number, grid: number, tolerance: number): boolean =>
  isClose(value, roundToGrid(value, grid), tolerance);

const sortedUnique = (values: readonly number[]): readonly number[] => {
  const unique = [...new Set(values)];
  const result: number[] = [];
  for (const value of unique) {
    let inserted = false;
    for (let index = 0; index < result.length; index += 1) {
      if (value < (result[index] ?? value)) {
        result.splice(index, 0, value);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(value);
  }
  return result;
};

const quantizeStart = (value: number, config: QuantizationConfig): number => {
  for (const grid of config.startStrongGrids) {
    const snapped = snapToGrid(value, grid, config.startStrongTolerance);
    if (snapped !== undefined) return snapped;
  }
  const baseSnap = snapToGrid(
    value,
    config.startGrid,
    config.startGridTolerance,
  );
  return baseSnap ?? roundToGrid(value, config.startGrid);
};

const allowDotted = (
  start: number,
  duration: number,
  config: QuantizationConfig,
): boolean =>
  isAligned(start, config.dottedGrid, config.dottedGridTolerance) &&
  isAligned(start + duration, config.dottedGrid, config.dottedGridTolerance);

const selectDuration = (
  rawDuration: number,
  start: number,
  config: QuantizationConfig,
): number => {
  let preferredValue: number | undefined;
  let preferredDiff = Number.POSITIVE_INFINITY;
  for (const candidate of config.durationPreferred) {
    const diff = Math.abs(rawDuration - candidate);
    if (diff <= config.durationPreferredTolerance && diff < preferredDiff) {
      preferredValue = candidate;
      preferredDiff = diff;
    }
  }
  if (preferredValue !== undefined) return preferredValue;
  const tolerance =
    rawDuration >= config.durationLongThreshold
      ? config.durationToleranceLong
      : config.durationToleranceShort;
  let bestValue: number | undefined;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of config.durationAllowed) {
    const dottedBlocked =
      config.dottedValues.includes(candidate) &&
      !allowDotted(start, candidate, config);
    if (!dottedBlocked) {
      const diff = Math.abs(rawDuration - candidate);
      if (diff <= tolerance && diff < bestDiff) {
        bestValue = candidate;
        bestDiff = diff;
      }
    }
  }
  return bestValue ?? roundToGrid(rawDuration, config.durationGrid);
};

const quantizeDuration = (
  rawDuration: number,
  start: number,
  nextStart: number | undefined,
  config: QuantizationConfig,
): number => {
  const selected = selectDuration(rawDuration, start, config);
  const endPre = start + selected;
  const endSnapped =
    snapToGrid(endPre, config.endGrid, config.endGridTolerance) ?? endPre;
  const endStrong =
    nextStart === undefined
      ? (snapToGrid(
          endSnapped,
          config.endStrongGrid,
          config.endStrongTolerance,
        ) ?? endSnapped)
      : endSnapped;
  const endClamped =
    config.clampToNextOnset &&
    nextStart !== undefined &&
    isClose(endStrong, nextStart, config.endClampTolerance)
      ? nextStart
      : endStrong;
  const duration = Math.max(endClamped - start, config.durationGrid);
  return normalize(duration, config.normalizeGrid);
};

export const quantizeNotes = Effect.fn("LilyPondQuantizer.quantizeNotes")(
  (notes: readonly Note[], options?: Partial<QuantizationConfig>) =>
    Effect.sync(() => {
      const config: QuantizationConfig = {
        ...defaultQuantizationConfig,
        ...options,
      };
      const starts = notes.map((note) =>
        quantizeStart(note.start_time, config),
      );
      const uniqueStarts = sortedUnique(starts);
      const nextStartMap = new Map<number, number | undefined>(
        uniqueStarts.map((start, index) => [start, uniqueStarts[index + 1]]),
      );
      return notes.map((note, index) => {
        const start = starts[index] ?? note.start_time;
        const nextStart = nextStartMap.get(start);
        const rawEnd = note.start_time + note.duration;
        const rawDuration = Math.max(rawEnd - start, config.durationGrid);
        const duration = quantizeDuration(
          rawDuration,
          start,
          nextStart,
          config,
        );
        return {
          ...note,
          start_time: normalize(start, config.normalizeGrid),
          duration,
        };
      });
    }),
);
