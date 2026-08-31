import type { Note } from "@/lib/Domain";

export type StaffSystem = "single-treble" | "single-bass" | "grand";

export interface StaffDecision {
  readonly system: StaffSystem;
  readonly splitPoint: number;
}

interface StaffDecisionOptions {
  readonly splitPoint: number;
  readonly bassRatioForBass: number;
  readonly trebleRatioForTreble: number;
  readonly minGrandRange: number;
  readonly minGrandNotes: number;
  readonly minGrandSideRatio: number;
}

const defaultOptions: StaffDecisionOptions = {
  splitPoint: 60,
  bassRatioForBass: 0.7,
  trebleRatioForTreble: 0.7,
  minGrandRange: 12,
  minGrandNotes: 6,
  minGrandSideRatio: 0.2,
};

const sortedBy = <T>(
  values: readonly T[],
  compare: (a: T, b: T) => number,
): readonly T[] => {
  const result: T[] = [];
  for (const value of values) {
    let inserted = false;
    for (let index = 0; index < result.length; index += 1) {
      const current = result[index];
      if (current !== undefined && compare(value, current) < 0) {
        result.splice(index, 0, value);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(value);
  }
  return result;
};

const medianPitch = (pitches: readonly number[], fallback: number): number => {
  if (pitches.length === 0) return fallback;
  const sorted = sortedBy(pitches, (a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? fallback;
  const lower = sorted[mid - 1] ?? fallback;
  const upper = sorted[mid] ?? fallback;
  return (lower + upper) / 2;
};

/**
 * Decide whether to render a single treble staff, single bass staff, or grand staff
 * based on pitch distribution and range thresholds.
 */
export const decideStaffSystem = (
  notes: readonly Note[],
  options?: Partial<StaffDecisionOptions>,
): StaffDecision => {
  const config: StaffDecisionOptions = { ...defaultOptions, ...options };
  const pitches = notes
    .map((note) => note.pitch)
    .filter((pitch) => Number.isFinite(pitch));
  const total = pitches.length;
  if (total === 0)
    return { system: "single-treble", splitPoint: config.splitPoint };
  let min = Infinity;
  let max = -Infinity;
  let bassCount = 0;
  for (const pitch of pitches) {
    if (pitch < min) min = pitch;
    if (pitch > max) max = pitch;
    if (pitch < config.splitPoint) bassCount += 1;
  }
  const trebleCount = total - bassCount;
  const bassRatio = bassCount / total;
  const trebleRatio = trebleCount / total;
  if (bassRatio >= config.bassRatioForBass)
    return { system: "single-bass", splitPoint: config.splitPoint };
  if (trebleRatio >= config.trebleRatioForTreble)
    return { system: "single-treble", splitPoint: config.splitPoint };
  const range = max - min;
  const grandCandidate =
    range >= config.minGrandRange &&
    total >= config.minGrandNotes &&
    bassRatio >= config.minGrandSideRatio &&
    trebleRatio >= config.minGrandSideRatio;
  if (grandCandidate) return { system: "grand", splitPoint: config.splitPoint };
  const median = medianPitch(pitches, config.splitPoint);
  const system: StaffSystem =
    median < config.splitPoint ? "single-bass" : "single-treble";
  return { system, splitPoint: config.splitPoint };
};
