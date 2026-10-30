import { assert, describe, it } from "@effect/vitest";

import {
  formatBeatTime,
  isOffGrid,
  type Meter,
  parseBeatTime,
} from "#domain/beatTime.ts";

const FOUR_FOUR: Meter = { numerator: 4, denominator: 4 };
const THREE_FOUR: Meter = { numerator: 3, denominator: 4 };
const SIX_EIGHT: Meter = { numerator: 6, denominator: 8 };

describe("formatBeatTime", () => {
  it("numbers positions from 1 and lengths from 0, as Live does", () => {
    assert.strictEqual(formatBeatTime(0, FOUR_FOUR, "position"), "1.1.1");
    assert.strictEqual(formatBeatTime(4.25, FOUR_FOUR, "position"), "2.1.2");
    assert.strictEqual(formatBeatTime(1, FOUR_FOUR, "length"), "0.1.0");
  });

  it("counts bars and beats in the clip's meter", () => {
    assert.strictEqual(formatBeatTime(3, THREE_FOUR, "position"), "2.1.1");
    assert.strictEqual(formatBeatTime(3, SIX_EIGHT, "position"), "2.1.1");
    assert.strictEqual(formatBeatTime(0.5, SIX_EIGHT, "position"), "1.2.1");
  });

  it("rounds to a sixteenth unless exact, which keeps the remainder", () => {
    assert.strictEqual(formatBeatTime(0.1, FOUR_FOUR, "position"), "1.1.1");
    assert.strictEqual(
      formatBeatTime(0.125, FOUR_FOUR, "position", { exact: true }),
      "1.1.1.5",
    );
    assert.isTrue(isOffGrid(0.125));
    assert.isFalse(isOffGrid(0.75));
  });
});

describe("parseBeatTime", () => {
  it("reads what formatBeatTime writes, in every meter", () => {
    for (const meter of [FOUR_FOUR, THREE_FOUR, SIX_EIGHT])
      for (const kind of ["position", "length"] as const)
        for (const beats of [0, 0.25, 1, 2.75, 7, 12.5])
          assert.strictEqual(
            parseBeatTime(formatBeatTime(beats, meter, kind), meter, kind),
            beats,
            `${String(beats)} ${kind} in ${String(meter.numerator)}/${String(meter.denominator)}`,
          );
  });

  it("accepts `.`, `,` and spaces, and defaults omitted segments", () => {
    assert.strictEqual(parseBeatTime("3", FOUR_FOUR, "position"), 8);
    assert.strictEqual(parseBeatTime("3.2.4", FOUR_FOUR, "position"), 9.75);
    assert.strictEqual(parseBeatTime("1, 2 3.5", FOUR_FOUR, "length"), 6.875);
  });

  it("reads the exact form's fractional sixteenth", () => {
    assert.strictEqual(parseBeatTime("1.1.1.5", FOUR_FOUR, "position"), 0.125);
  });

  it("carries overflowing segments into the next unit", () => {
    assert.strictEqual(parseBeatTime("1.5.1", FOUR_FOUR, "position"), 4);
  });

  it("rejects text that is not bar.beat.sixteenth", () => {
    for (const text of ["", "x", "1.2.3.4.5", "-1"])
      assert.isNull(parseBeatTime(text, FOUR_FOUR, "position"), text);
  });
});
