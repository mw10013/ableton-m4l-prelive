import { describe, expect, it } from "@effect/vitest";

import { findWindow, keySteps, latin, textKey } from "#scripts/lq/screen.ts";

describe("lq screen", () => {
  it("sends shortcuts and text through System Events, key names through cliclick", () => {
    expect(keySteps(["cmd+shift+g", "a b", "arrow-down"])).toEqual([
      { jxa: 'se.keystroke("g", { using: ["command down","shift down"] })' },
      { jxa: 'se.keystroke("a b")' },
      { cliclick: "kp:arrow-down" },
    ]);
    expect(keySteps(["ab", "return"], { paced: true, native: true })).toEqual([
      { jxa: 'se.keystroke("a")' },
      { jxa: 'se.keystroke("b")' },
      { jxa: "se.keyCode(36)" },
    ]);
  });

  it("picks the Set's window by default and plug-in windows by name", () => {
    const all = [
      { id: 1, name: "Omnisphere/Omni", x: 0, y: 0, width: 1392, height: 823 },
      { id: 2, name: "Melodic House", x: 0, y: 0, width: 1321, height: 754 },
    ];
    expect(findWindow(all, "")?.id).toBe(2);
    expect(findWindow(all, "omni")?.id).toBe(1);
  });

  it("reads Cyrillic lookalikes as Latin and matches names through OCR's confusions", () => {
    expect(latin("МОРНО - Bargain Bin")).toBe("MOPHO - Bargain Bin");
    expect(textKey("Cllcky Cool JP Organ")).toBe(
      textKey("Clicky Cool JP Organ"),
    );
    expect(textKey("SHO1A - Stained Pluck")).toBe(
      textKey("SH01A - Stained Pluck"),
    );
    expect(textKey("JUNO -Pluckin'")).toBe(textKey("JUNO - Pluckin’"));
    expect(textKey("Synth Bass")).not.toBe(textKey("Synth Base"));
  });
});
