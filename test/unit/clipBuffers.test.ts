import { assert, describe, it } from "@effect/vitest";

import {
  activeRowsOf,
  type BuffersAction,
  buffersReducer,
  EMPTY_BUFFERS,
  slotSummaryOf,
} from "#domain/clipBuffers.ts";
import type { Note } from "#domain/live.ts";

const note = (note_id: number, pitch: number, start_time: number): Note => ({
  note_id,
  pitch,
  start_time,
  duration: 1,
  velocity: 100,
  mute: false,
  probability: 1,
  velocity_deviation: 0,
  release_velocity: 64,
});

const run = (...actions: readonly BuffersAction[]) =>
  actions.reduce(buffersReducer, EMPTY_BUFFERS);

const LOAD: BuffersAction = {
  type: "load",
  notes: [note(900, 64, 1), note(901, 60, 0)],
};

describe("buffersReducer", () => {
  it("loads the clip into baseline, A and B, numbering rows in musical order", () => {
    const state = run(LOAD);
    assert.deepStrictEqual(
      activeRowsOf(state).map(({ id, pitch }) => [id, pitch]),
      [
        [1, 60],
        [2, 64],
      ],
    );
    assert.strictEqual(state.nextId, 3);
    assert.isFalse(slotSummaryOf(state).anyDiffersFromBaseline);
  });

  it("edits only the active slot, and switching shows the other", () => {
    const loaded = run(LOAD);
    const edited = run(
      LOAD,
      { type: "edit", rows: activeRowsOf(loaded).slice(1) },
      { type: "switch" },
    );
    assert.strictEqual(edited.active, "b");
    assert.strictEqual(activeRowsOf(edited).length, 2);
    assert.include(slotSummaryOf(edited), {
      activeDiffersFromBaseline: false,
      otherDiffersFromBaseline: true,
      slotsDiffer: true,
    });
  });

  it("reverts the active slot to the baseline", () => {
    const loaded = run(LOAD);
    const state = run(LOAD, { type: "edit", rows: [] }, { type: "revert" });
    assert.deepStrictEqual(activeRowsOf(state), activeRowsOf(loaded));
  });

  it("copies the active slot over the other", () => {
    const state = run(
      LOAD,
      { type: "edit", rows: [] },
      { type: "copyToOther" },
      { type: "switch" },
    );
    assert.deepStrictEqual(activeRowsOf(state), []);
    assert.isFalse(slotSummaryOf(state).slotsDiffer);
  });
});
