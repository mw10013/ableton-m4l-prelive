import "#web/styles.css";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import { render } from "vitest-browser-react";

import type { EditableField, NoteRow } from "#domain/noteEdits.ts";
import { NoteTable } from "#web/components/NoteTable.tsx";

const row = (id: number, fields: Partial<NoteRow>): NoteRow => ({
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

const NOTES = [
  row(1, { pitch: 60, start_time: 0 }),
  row(2, { pitch: 64, start_time: 1 }),
];

interface Calls {
  readonly commits: [number, EditableField, number][];
  readonly mutes: [number, boolean][];
  added: number;
  selected: readonly string[];
}

const renderTable = async (notes: readonly NoteRow[] = NOTES) => {
  const calls: Calls = { commits: [], mutes: [], added: 0, selected: [] };
  function Harness() {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    calls.selected = [...selectedKeys];
    return (
      <Theme theme={neutralTheme}>
        <NoteTable
          notes={notes}
          signatureNumerator={4}
          signatureDenominator={4}
          selectedKeys={selectedKeys}
          setSelectedKeys={setSelectedKeys}
          isDisabled={false}
          showDetails={false}
          onCommitField={(id, field, value) => {
            calls.commits.push([id, field, value]);
          }}
          onToggleMute={(id, mute) => {
            calls.mutes.push([id, mute]);
          }}
          onAddNote={() => {
            calls.added += 1;
            return 99;
          }}
          rowActions={() => []}
        />
      </Theme>
    );
  }
  return { screen: await render(<Harness />), calls };
};

describe("NoteTable", () => {
  it("shows each note's pitch and its position as bar.beat.sixteenth", async () => {
    const { screen } = await renderTable();
    const pitches = screen.getByRole("spinbutton", { name: /^Pitch of note/u });
    await expect.element(pitches.first()).toBeVisible();
    expect(pitches.elements()).toHaveLength(2);
    expect(
      screen
        .getByRole("spinbutton", { name: /^Start of note/u })
        .elements()
        .map((cell) => cell.getAttribute("aria-valuetext")),
    ).toStrictEqual(["1.1.1", "1.2.1"]);
  });

  it("toggles mute from the M cell", async () => {
    const { screen, calls } = await renderTable();
    await screen
      .getByRole("button", { name: /^Mute note/u })
      .first()
      .click();
    expect(calls.mutes).toStrictEqual([[1, true]]);
  });

  it("edits a cell from the keyboard and commits the typed value", async () => {
    const { screen, calls } = await renderTable();
    const pitch = screen
      .getByRole("spinbutton", { name: /^Pitch of note/u })
      .first();
    await pitch.click();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.activeElement?.tagName).toBe("INPUT");
    await userEvent.keyboard("{Meta>}a{/Meta}67{Enter}");
    expect(calls.commits).toStrictEqual([[1, "pitch", 67]]);
  });

  it("selects the next row with the Down arrow", async () => {
    const { screen, calls } = await renderTable();
    await screen
      .getByRole("spinbutton", { name: /^Pitch of note/u })
      .first()
      .click();
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => calls.selected).toStrictEqual(["2"]);
  });
});
