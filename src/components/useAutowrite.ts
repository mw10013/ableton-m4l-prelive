import type { ClipRegion, ReplaceNotesInput } from "@/lib/Domain";
import type { NoteRow } from "@/lib/noteEdits";

import { useCallback, useEffect, useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { toReplacementNotes } from "@/lib/noteEdits";

export const AUTOWRITE_DELAY_MS = 500;

export type AutowriteStatus = "idle" | "pending" | "writing";

export interface AutowriteState {
  readonly status: AutowriteStatus;
  readonly lastError: string | null;
}

interface Sent {
  readonly loadId: number;
  readonly clipId: number;
  readonly rows: readonly NoteRow[];
  readonly region: ClipRegion | undefined;
}

/**
 * Writes the active note list to Live after a trailing debounce. Fire and
 * forget: the response is never merged back and a failed write is simply
 * overwritten by the next one. At most one write is in flight; edits that
 * land while one is running collapse into a single follow-up write carrying
 * the newest list. The rows present when a clip loads count as already sent,
 * so a load never triggers a write: `loadId` changes on every load or reload
 * and resets what counts as sent. Browser glue only, no Effect.
 */
export function useAutowrite({
  clipId,
  loadId,
  rows,
  region,
  write,
}: {
  readonly clipId: number;
  readonly loadId: number;
  readonly rows: readonly NoteRow[];
  readonly region: ClipRegion | undefined;
  readonly write: (input: ReplaceNotesInput) => Promise<unknown>;
}): AutowriteState & { readonly flushNow: () => void } {
  const [isArmed, setIsArmed] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const { mutateAsync, isPending: isWriting } = useMutation({
    mutationFn: write,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const latest = useRef<Sent>({ loadId, clipId, rows, region });
  latest.current = { loadId, clipId, rows, region };
  const lastSent = useRef<Sent>({ loadId, clipId, rows, region });

  const disarm = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setIsArmed(false);
  }, []);

  const flush = useCallback(() => {
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    const sent = latest.current;
    lastSent.current = sent;
    inFlight.current = true;
    dirty.current = false;
    void mutateAsync({
      clipId: sent.clipId,
      notes: toReplacementNotes(sent.rows),
      region: sent.region,
    })
      .then(
        () => {
          setLastError(null);
        },
        (error: unknown) => {
          setLastError(
            error instanceof Error ? error.message : "Write failed.",
          );
        },
      )
      .finally(() => {
        inFlight.current = false;
        if (dirty.current && latest.current.loadId === sent.loadId) flush();
      });
  }, [mutateAsync]);

  const flushNow = useCallback(() => {
    disarm();
    flush();
  }, [disarm, flush]);

  useEffect(() => {
    const sent = lastSent.current;
    if (sent.loadId !== loadId) {
      // A fresh load: what is shown is what Live holds. No flush; a clip switch means the user left.
      disarm();
      dirty.current = false;
      setLastError(null);
      lastSent.current = { loadId, clipId, rows, region };
      return;
    }
    if (sent.rows === rows && sent.region === region) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setIsArmed(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setIsArmed(false);
      flush();
    }, AUTOWRITE_DELAY_MS);
  }, [loadId, clipId, rows, region, disarm, flush]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const status: AutowriteStatus =
    (
      [
        ["pending", isArmed],
        ["writing", isWriting],
      ] as const
    ).find(([, isActive]) => isActive)?.[0] ?? "idle";
  return {
    status,
    lastError,
    flushNow,
  };
}
