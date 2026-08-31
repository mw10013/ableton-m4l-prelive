import type { Note } from "@/lib/Domain";

import { decideStaffSystem } from "@/lib/score/staffDecision";
interface LilyPondOptions {
  readonly tempo: number;
  readonly timeSignature: readonly [number, number];
  readonly gridSize: number;
  readonly splitPoint: number;
}

interface Event {
  readonly start: number;
  readonly duration: number;
  readonly pitches: readonly number[];
}

interface VoiceLine {
  readonly events: readonly Event[];
}

const defaultOptions: LilyPondOptions = {
  tempo: 120,
  timeSignature: [4, 4],
  gridSize: 1 / 16,
  splitPoint: 60,
};

const noteNames = [
  "c",
  "cis",
  "d",
  "dis",
  "e",
  "f",
  "fis",
  "g",
  "gis",
  "a",
  "ais",
  "b",
];

const durationTable = [
  { beats: 4, token: "1" },
  { beats: 3, token: "2." },
  { beats: 2, token: "2" },
  { beats: 1.5, token: "4." },
  { beats: 1, token: "4" },
  { beats: 0.75, token: "8." },
  { beats: 0.5, token: "8" },
  { beats: 0.375, token: "16." },
  { beats: 0.25, token: "16" },
  { beats: 0.1875, token: "32." },
  { beats: 0.125, token: "32" },
  { beats: 0.093_75, token: "64." },
  { beats: 0.0625, token: "64" },
  { beats: 0.046_875, token: "128." },
  { beats: 0.031_25, token: "128" },
];

const epsilon = 1e-6;

const roundToGrid = (value: number, gridSize: number): number =>
  Math.round(value / gridSize) * gridSize;

const pitchToLily = (pitch: number): string => {
  const octave = Math.floor(pitch / 12) - 1;
  const name = noteNames[pitch % 12] ?? "c";
  const marks = octave - 3;
  if (marks > 0) return name + "'".repeat(marks);
  if (marks < 0) return name + ",".repeat(-marks);
  return name;
};

const splitDuration = (beats: number): readonly string[] => {
  const tokens: string[] = [];
  let remaining = beats;
  for (const { beats: value, token } of durationTable) {
    while (remaining + epsilon >= value) {
      tokens.push(token);
      remaining = roundToGrid(remaining - value, 1 / 1024);
    }
    if (remaining <= epsilon) break;
  }
  return tokens.length > 0 ? tokens : ["64"];
};

const splitRestDuration = (
  start: number,
  duration: number,
  beatLength: number,
  gridSize: number,
): readonly number[] => {
  const parts: number[] = [];
  let remaining = duration;
  let cursor = roundToGrid(start, gridSize);
  while (remaining > epsilon) {
    const beatIndex = Math.floor((cursor + epsilon) / beatLength);
    const nextBeat = roundToGrid((beatIndex + 1) * beatLength, gridSize);
    const untilNextBeat = roundToGrid(nextBeat - cursor, gridSize);
    const segment =
      untilNextBeat > epsilon ? Math.min(remaining, untilNextBeat) : remaining;
    parts.push(segment);
    cursor = roundToGrid(cursor + segment, gridSize);
    remaining = roundToGrid(remaining - segment, gridSize);
  }
  return parts;
};

const formatChord = (pitches: readonly number[], tie: boolean): string => {
  if (pitches.length === 1) {
    const pitch = pitches[0];
    return `${pitchToLily(pitch)}${tie ? "~" : ""}`;
  }
  const parts = pitches.map((pitch) => pitchToLily(pitch));
  return `<${parts.join(" ")}>${tie ? "~" : ""}`;
};

const buildEvents = (
  notes: readonly Note[],
  gridSize: number,
): readonly Event[] => {
  const grouped = new Map<
    string,
    { start: number; duration: number; pitches: number[] }
  >();
  for (const note of notes) {
    const start = roundToGrid(note.start_time, gridSize);
    const duration = roundToGrid(note.duration, gridSize);
    const key = `${String(start)}:${String(duration)}`;
    const entry = grouped.get(key) ?? { start, duration, pitches: [] };
    entry.pitches.push(note.pitch);
    grouped.set(key, entry);
  }
  const events: Event[] = [];
  for (const entry of grouped.values()) {
    // oxlint-disable-next-line unicorn/no-array-sort
    const pitches = [...new Set(entry.pitches)].sort((a, b) => a - b);
    events.push({ start: entry.start, duration: entry.duration, pitches });
  }
  return events;
};

const assignVoices = (events: readonly Event[]): readonly VoiceLine[] => {
  // oxlint-disable-next-line unicorn/no-array-sort
  const sorted = [...events].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const maxA = Math.max(...a.pitches);
    const maxB = Math.max(...b.pitches);
    if (maxA !== maxB) return maxB - maxA;
    return b.duration - a.duration;
  });
  const voices: { end: number; events: Event[] }[] = [];
  for (const event of sorted) {
    let placed = false;
    for (const voice of voices) {
      if (event.start >= voice.end - epsilon) {
        voice.events.push(event);
        voice.end = event.start + event.duration;
        placed = true;
        break;
      }
    }
    if (!placed) {
      voices.push({ end: event.start + event.duration, events: [event] });
    }
  }
  return voices.map((voice) => ({ events: voice.events }));
};

const tokensForDuration = (
  duration: number,
  pitches: readonly number[],
): readonly string[] => {
  const parts = splitDuration(duration);
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const tie = i < parts.length - 1;
    const chord = pitches.length > 0 ? formatChord(pitches, tie) : "r";
    tokens.push(`${chord}${parts[i]}`);
  }
  return tokens;
};

const tokensForRestDuration = (
  start: number,
  duration: number,
  beatLength: number,
  gridSize: number,
): readonly string[] => {
  const segments = splitRestDuration(start, duration, beatLength, gridSize);
  const tokens: string[] = [];
  for (const segment of segments)
    tokens.push(...tokensForDuration(segment, []));
  return tokens;
};

const voiceToTokens = (
  events: readonly Event[],
  totalEnd: number,
  beatLength: number,
  gridSize: number,
): readonly string[] => {
  const tokens: string[] = [];
  let cursor = 0;
  for (const event of events) {
    if (event.start > cursor + epsilon) {
      const restDuration = event.start - cursor;
      tokens.push(
        ...tokensForRestDuration(cursor, restDuration, beatLength, gridSize),
      );
    }
    tokens.push(...tokensForDuration(event.duration, event.pitches));
    cursor = event.start + event.duration;
  }
  if (cursor + epsilon < totalEnd) {
    tokens.push(
      ...tokensForRestDuration(cursor, totalEnd - cursor, beatLength, gridSize),
    );
  }
  return tokens;
};

export const notesToLilyPond = (
  notes: readonly Note[],
  options?: Partial<LilyPondOptions>,
): string => {
  const config: LilyPondOptions = { ...defaultOptions, ...options };
  const [numerator, denominator] = config.timeSignature;
  const beatLength = 4 / denominator;
  const measureLength = numerator * (4 / denominator);
  const events = buildEvents(notes, config.gridSize);
  const totalEnd = Math.max(
    0,
    ...events.map((event) => event.start + event.duration),
  );
  const roundedEnd = roundToGrid(
    Math.ceil(totalEnd / measureLength) * measureLength,
    config.gridSize,
  );
  const voices = assignVoices(events);
  const voiceTokens = voices.map((voice) =>
    voiceToTokens(voice.events, roundedEnd, beatLength, config.gridSize).join(
      " ",
    ),
  );
  const voiceCommands = [
    String.raw`\voiceOne`,
    String.raw`\voiceTwo`,
    String.raw`\voiceThree`,
    String.raw`\voiceFour`,
  ];
  const staffDecision = decideStaffSystem(notes, {
    splitPoint: config.splitPoint,
  });
  const autoChangePitch = pitchToLily(staffDecision.splitPoint);
  const voiceBlocks = voiceTokens.map((line, index) => {
    const command = voiceCommands[index] ?? String.raw`\voiceOne`;
    if (staffDecision.system === "grand") {
      return `{ ${command} \\autoChange ${autoChangePitch} { ${line} } }`;
    }
    return `{ ${command} ${line} }`;
  });
  let body = voiceTokens[0] ?? "r1";
  if (voiceTokens.length > 1) {
    body = `<< ${voiceBlocks.join(String.raw` \\ `)} >>`;
  } else if (staffDecision.system === "grand") {
    body = `\\autoChange ${autoChangePitch} { ${voiceTokens[0] ?? "r1"} }`;
  }
  const clef = staffDecision.system === "single-bass" ? "bass" : "treble";
  if (staffDecision.system === "grand") {
    return [
      String.raw`\version "2.24.4"`,
      "",
      String.raw`\score {`,
      String.raw`  \new PianoStaff <<`,
      String.raw`    \new Staff = "up" {`,
      String.raw`      \clef treble`,
      String.raw`      \time ${String(numerator)}/${String(denominator)}`,
      String.raw`      \set Score.proportionalNotationDuration = #1/16`,
      String.raw`      \override Score.SpacingSpanner.strict-note-spacing = ##t`,
      `      ${body}`,
      String.raw`    }`,
      String.raw`    \new Staff = "down" {`,
      String.raw`      \clef bass`,
      String.raw`    }`,
      String.raw`  >>`,
      String.raw`  \layout {}`,
      String.raw`  \midi {}`,
      "}",
    ].join("\n");
  }
  return [
    String.raw`\version "2.24.4"`,
    "",
    String.raw`\score {`,
    String.raw`  \new Staff {`,
    String.raw`    \clef ${clef}`,
    String.raw`    \time ${String(numerator)}/${String(denominator)}`,
    String.raw`    \set Score.proportionalNotationDuration = #1/16`,
    String.raw`    \override Score.SpacingSpanner.strict-note-spacing = ##t`,
    `    ${body}`,
    "  }",
    String.raw`  \layout {}`,
    String.raw`  \midi {}`,
    "}",
  ].join("\n");
};
