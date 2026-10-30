import { assert, describe, it } from "@effect/vitest";

import {
  defaultDestination,
  duplicateNotes,
  type NoteRow,
  requiredPlaybackRegion,
  setField,
  shiftField,
} from "#domain/noteEdits.ts";

const row = (id: number, fields: Partial<NoteRow> = {}): NoteRow => ({
  id,
  pitch: 60,
  start_time: 0,
  duration: 1,
  velocity: 100,
  mute: false,
  probability: 1,
  velocity_deviation: 0,
  release_velocity: 64,
  ...fields,
});

const field = (notes: readonly NoteRow[], key: keyof NoteRow) =>
  notes.map((note) => note[key]);

describe("shiftField", () => {
  it("stops the whole group when one member reaches a bound, keeping the voicing", () => {
    const chord = [row(1, { pitch: 120 }), row(2, { pitch: 125 })];
    assert.deepStrictEqual(
      field(shiftField(chord, new Set([1, 2]), "pitch", 5), "pitch"),
      [122, 127],
    );
  });

  it("moves integer fields by a whole step, the same for every member", () => {
    const notes = [row(1, { pitch: 60 }), row(2, { pitch: 64 })];
    assert.deepStrictEqual(
      field(shiftField(notes, new Set([1, 2]), "pitch", 1.6), "pitch"),
      [62, 66],
    );
  });

  it("leaves notes outside the targets alone", () => {
    const notes = [row(1, { velocity: 10 }), row(2, { velocity: 10 })];
    assert.deepStrictEqual(
      field(shiftField(notes, new Set([2]), "velocity", 5), "velocity"),
      [10, 15],
    );
  });
});

describe("setField", () => {
  it("clamps to the field's range", () => {
    const notes = [row(1), row(2)];
    assert.deepStrictEqual(
      field(setField(notes, new Set([1, 2]), "probability", 3), "probability"),
      [1, 1],
    );
  });
});

describe("duplicateNotes", () => {
  it("copies the selection to the destination with fresh ids, in musical order", () => {
    const notes = [
      row(1, { start_time: 0, pitch: 64 }),
      row(2, { start_time: 0.5, pitch: 60 }),
    ];
    const result = duplicateNotes({
      notes,
      selected: notes,
      destination: 4,
      firstId: 10,
    });
    assert.deepStrictEqual(field(result.copies, "start_time"), [4, 4.5]);
    assert.deepStrictEqual(field(result.copies, "id"), [10, 11]);
    assert.strictEqual(result.nextId, 12);
    assert.deepStrictEqual(field(result.notes, "id"), [1, 2, 10, 11]);
  });

  it("defaults the destination to the next quarter after the selection, despite float drift", () => {
    assert.strictEqual(
      defaultDestination([row(1, { start_time: 1.1, duration: 0.9 + 1e-12 })]),
      2,
    );
  });
});

describe("requiredPlaybackRegion", () => {
  const region = { start: 0, end: 4 };

  it("grows to whole bars to fit every note", () => {
    assert.deepStrictEqual(
      requiredPlaybackRegion({
        notes: [row(1, { start_time: 5, duration: 0.5 })],
        region,
        quartersPerBar: 4,
      }),
      { start: 0, end: 8 },
    );
  });

  it("does not claim the next bar for a note ending on a bar line", () => {
    assert.deepStrictEqual(
      requiredPlaybackRegion({
        notes: [row(1, { start_time: 3, duration: 1 })],
        region,
        quartersPerBar: 4,
      }),
      region,
    );
  });

  it("never shrinks the region", () => {
    assert.deepStrictEqual(
      requiredPlaybackRegion({ notes: [], region, quartersPerBar: 4 }),
      region,
    );
  });
});
