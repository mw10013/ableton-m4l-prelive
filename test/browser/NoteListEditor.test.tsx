import "#web/styles.css";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as Function from "effect/Function";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import type { NoteRow } from "#domain/noteEdits.ts";
import { NoteListEditor } from "#web/components/NoteListEditor.tsx";

const NOTE: NoteRow = {
  id: 1,
  pitch: 60,
  start_time: 0,
  duration: 1,
  velocity: 100,
  mute: false,
  probability: 1,
  velocity_deviation: 0,
  release_velocity: 64,
};

const renderEditor = () =>
  render(
    <Theme theme={neutralTheme}>
      <NoteListEditor
        clip={{
          id: 7,
          signatureNumerator: 4,
          signatureDenominator: 4,
          playback: { start: 0, end: 4 },
        }}
        notes={[NOTE]}
        onNotesChange={Function.constVoid}
        mintRowIds={(count) => Array.from({ length: count }, (_, i) => 100 + i)}
        status="idle"
        autowrite={{ status: "idle", lastError: null }}
        slots={{
          active: "a",
          activeDiffersFromBaseline: false,
          otherDiffersFromBaseline: false,
          slotsDiffer: false,
          anyDiffersFromBaseline: false,
        }}
        reloadError={null}
        onSwitchSlot={Function.constVoid}
        onCopyToOther={Function.constVoid}
        onRevert={Function.constVoid}
        onSetBaseline={Function.constVoid}
        onReload={Function.constVoid}
      />
    </Theme>,
  );

const chanceCells = (screen: Awaited<ReturnType<typeof renderEditor>>) =>
  screen.getByRole("spinbutton", { name: /^Chance of note/u });

describe("NoteListEditor Details toggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with the detail columns hidden", async () => {
    const screen = await renderEditor();
    await expect
      .element(screen.getByRole("button", { name: "Details" }))
      .toBeVisible();
    expect(chanceCells(screen).elements()).toHaveLength(0);
  });

  it("shows the detail columns and remembers the choice across a remount", async () => {
    const first = await renderEditor();
    await first.getByRole("button", { name: "Details" }).click();
    await expect.element(chanceCells(first).first()).toBeVisible();
    await first.unmount();

    const second = await renderEditor();
    await expect.element(chanceCells(second).first()).toBeVisible();
    await expect
      .element(second.getByRole("button", { name: "Details" }))
      .toHaveAttribute("aria-pressed", "true");
  });
});
