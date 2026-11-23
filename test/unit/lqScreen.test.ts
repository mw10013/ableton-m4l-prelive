import { describe, expect, it } from "@effect/vitest";

import { findWindow, keyCommands } from "#scripts/lq/screen.ts";

describe("lq screen", () => {
  it("turns key tokens into cliclick commands", () => {
    expect(keyCommands(["cmd+f", "a b", "arrow-down", "return"])).toEqual([
      "kd:cmd",
      "t:f",
      "ku:cmd",
      "t:a",
      "kp:space",
      "t:b",
      "kp:arrow-down",
      "kp:return",
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
});
