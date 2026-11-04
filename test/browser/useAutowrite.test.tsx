import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { renderHook } from "vitest-browser-react";

import type { ReplaceNotesInput } from "#domain/live.ts";
import type { NoteRow } from "#domain/noteEdits.ts";
import {
  AUTOWRITE_DELAY_MS,
  useAutowrite,
} from "#web/components/useAutowrite.ts";

const row = (id: number, pitch: number): NoteRow => ({
  id,
  pitch,
  start_time: 0,
  duration: 1,
  velocity: 100,
  mute: false,
  probability: 1,
  velocity_deviation: 0,
  release_velocity: 64,
});

/** A write Live has not answered yet; `settle` answers the oldest. */
const pendingWrites = () => {
  const sent: ReplaceNotesInput[] = [];
  const answers: (() => void)[] = [];
  return {
    sent,
    write: (input: ReplaceNotesInput) =>
      new Promise<void>((resolve) => {
        sent.push(input);
        answers.push(resolve);
      }),
    settle: () => answers.shift()?.(),
  };
};

const pitches = (input: ReplaceNotesInput | undefined) =>
  input?.notes.map((note) => note.pitch);

const PAST_DEBOUNCE = AUTOWRITE_DELAY_MS + 300;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const renderAutowrite = async (
  write: (input: ReplaceNotesInput) => Promise<unknown>,
) => {
  const client = new QueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return renderHook(
    (props: { loadId: number; rows: readonly NoteRow[] } | undefined) =>
      useAutowrite({
        clipId: 7,
        loadId: props?.loadId ?? 1,
        rows: props?.rows ?? LOADED,
        region: undefined,
        write,
      }),
    { wrapper: Wrapper, initialProps: { loadId: 1, rows: LOADED } },
  );
};

const LOADED = [row(1, 60)];

describe("useAutowrite", () => {
  it("never writes the rows a clip loaded with", async () => {
    const writes = pendingWrites();
    await renderAutowrite(writes.write);
    await sleep(PAST_DEBOUNCE);
    expect(writes.sent).toHaveLength(0);
  });

  it("writes the newest list once the edits pause", async () => {
    const writes = pendingWrites();
    const { result, rerender } = await renderAutowrite(writes.write);
    await rerender({ loadId: 1, rows: [row(1, 61)] });
    await rerender({ loadId: 1, rows: [row(1, 62)] });
    await expect.poll(() => result.current.status).toBe("pending");
    await expect.poll(() => writes.sent.length).toBe(1);
    expect(pitches(writes.sent[0])).toStrictEqual([62]);
    expect(writes.sent[0]?.clipId).toBe(7);
  });

  it("collapses edits made during a write into one follow-up with the newest list", async () => {
    const writes = pendingWrites();
    const { result, rerender } = await renderAutowrite(writes.write);
    await rerender({ loadId: 1, rows: [row(1, 61)] });
    await expect.poll(() => writes.sent.length).toBe(1);
    await rerender({ loadId: 1, rows: [row(1, 62)] });
    await sleep(PAST_DEBOUNCE);
    await rerender({ loadId: 1, rows: [row(1, 63)] });
    await sleep(PAST_DEBOUNCE);
    expect(writes.sent).toHaveLength(1);
    writes.settle();
    await expect.poll(() => writes.sent.length).toBe(2);
    expect(pitches(writes.sent[1])).toStrictEqual([63]);
    writes.settle();
    await expect.poll(() => result.current.status).toBe("idle");
  });

  it("drops a pending write when the clip reloads", async () => {
    const writes = pendingWrites();
    const { rerender } = await renderAutowrite(writes.write);
    await rerender({ loadId: 1, rows: [row(1, 61)] });
    await rerender({ loadId: 2, rows: [row(1, 70)] });
    await sleep(PAST_DEBOUNCE);
    expect(writes.sent).toHaveLength(0);
  });

  it("writes at once on flushNow", async () => {
    const writes = pendingWrites();
    const { result, rerender } = await renderAutowrite(writes.write);
    await rerender({ loadId: 1, rows: [row(1, 61)] });
    result.current.flushNow();
    await expect.poll(() => writes.sent.length, { timeout: 200 }).toBe(1);
  });
});
