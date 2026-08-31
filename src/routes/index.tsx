import { useEffect, useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { NoteTable } from "@/components/NoteTable";
import { ScoreDisplay } from "@/components/ScoreDisplay";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClipWithNotes, Note } from "@/lib/Domain";
import {
  fireClip,
  readClip,
  readClipBySlot,
  readLiveSetOverview,
  togglePlay,
  writeNotes,
} from "@/lib/liveql";

interface ClipInfo {
  id: number;
  name: string;
  path: string;
  length: number;
  signatureNumerator: number;
  signatureDenominator: number;
}

interface SelectedSlot {
  trackIndex: number;
  slotIndex: number;
  clipId: number;
}

type LiveSetOverview = Awaited<ReturnType<typeof readLiveSetOverview>>["live_set"];

let nextTempId = -1;

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [overview, setOverview] = useState<LiveSetOverview | null>(null);
  const [liveSelectedClipId, setLiveSelectedClipId] = useState<number | null>(
    null,
  );
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [modifiedNoteIds, setModifiedNoteIds] = useState<Set<number>>(
    new Set(),
  );
  const [deletedNoteIds, setDeletedNoteIds] = useState<Set<number>>(new Set());
  const [scoreRenderToken, setScoreRenderToken] = useState(0);

  const applyClip = ({
    clip,
    trackName,
  }: {
    clip: ClipWithNotes;
    trackName: string | null;
  }) => {
    setTrackName(trackName);
    setClipInfo({
      id: clip.id,
      name: clip.name,
      path: clip.path,
      length: clip.length,
      signatureNumerator: clip.signature_numerator,
      signatureDenominator: clip.signature_denominator,
    });
    setNotes([...(clip.notes ?? [])]);
    setModifiedNoteIds(new Set());
    setDeletedNoteIds(new Set());
    setScoreRenderToken((prev) => prev + 1);
  };

  const overviewMutation = useMutation({
    mutationFn: () => readLiveSetOverview(),
    onSuccess: (data) => {
      setOverview(data.live_set);
      setLiveSelectedClipId(data.live_set.view.detail_clip?.id ?? null);
    },
  });

  const readMutation = useMutation({
    mutationFn: () => readClip(),
    onSuccess: (data) => {
      const detailClip = data.live_set.view.detail_clip;
      setLiveSelectedClipId(detailClip?.id ?? null);
      if (!detailClip) return;
      applyClip({
        clip: detailClip,
        trackName: data.live_set.view.selected_track?.name ?? null,
      });
    },
  });

  const readBySlotMutation = useMutation({
    mutationFn: readClipBySlot,
    onSuccess: (data) => {
      const track = data.live_set.track;
      const clip = track?.clip_slot?.clip;
      if (!track || !clip) return;
      applyClip({ clip, trackName: track.name });
    },
  });

  const writeMutation = useMutation({
    mutationFn: writeNotes,
    onSuccess: () => {
      if (selectedSlot) {
        readBySlotMutation.mutate({
          data: {
            trackIndex: selectedSlot.trackIndex,
            slotIndex: selectedSlot.slotIndex,
          },
        });
        return;
      }
      readMutation.mutate();
    },
  });

  const { mutate: togglePlayMutate, isPending: isTogglePlayPending } =
    useMutation({ mutationFn: togglePlay });

  const fireClipMutation = useMutation({ mutationFn: fireClip });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
            target.tagName,
          ))
      )
        return;
      event.preventDefault();
      if (!isTogglePlayPending) {
        togglePlayMutate({ data: {} });
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [isTogglePlayPending, togglePlayMutate]);

  const handleWrite = () => {
    if (!clipInfo) return;
    writeMutation.mutate({
      data: {
        clipId: clipInfo.id,
        newNotes: notes
          .filter((n) => n.note_id < 0)
          .map(({ note_id: _, ...rest }) => rest),
        modifiedNotes: notes.filter(
          (n) => modifiedNoteIds.has(n.note_id) && n.note_id > 0,
        ),
        removedNoteIds: [...deletedNoteIds],
      },
    });
  };

  const handleAddNote = () => {
    setNotes((prev) => [
      ...prev,
      {
        note_id: nextTempId--,
        pitch: 60,
        start_time: 0,
        duration: 1,
        velocity: 100,
        mute: false,
        probability: 1,
        velocity_deviation: 0,
        release_velocity: 64,
      },
    ]);
  };

  const maxSlots =
    overview?.tracks.reduce(
      (m, t) => (t.clip_slots.length > m ? t.clip_slots.length : m),
      0,
    ) ?? 0;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex items-center gap-2">
        <Button
          onClick={() => {
            readMutation.mutate();
          }}
          disabled={readMutation.isPending}
        >
          {readMutation.isPending ? "Reading…" : "Read from Live"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setScoreRenderToken((prev) => prev + 1);
          }}
          disabled={!clipInfo || notes.length === 0}
        >
          Preview Score
        </Button>
        <Button
          onClick={handleWrite}
          disabled={!clipInfo || writeMutation.isPending}
        >
          {writeMutation.isPending ? "Writing…" : "Write to Live"}
        </Button>
        <Button
          variant="secondary"
          onClick={handleAddNote}
          disabled={!clipInfo}
        >
          + Note
        </Button>
        <Button
          onClick={() => {
            if (clipInfo)
              fireClipMutation.mutate({ data: { clipId: clipInfo.id } });
          }}
          disabled={!clipInfo || notes.length === 0 || fireClipMutation.isPending}
        >
          {fireClipMutation.isPending ? "Firing…" : "Play Clip"}
        </Button>
        {clipInfo && (
          <span className="ml-auto text-sm text-muted-foreground">
            {trackName && <>{trackName} / </>}
            {clipInfo.name} — {clipInfo.path} ({clipInfo.length} beats)
          </span>
        )}
      </div>

      {readMutation.isError && (
        <p className="mb-2 text-sm text-destructive">
          {readMutation.error instanceof Error
            ? readMutation.error.message
            : "Read failed"}
        </p>
      )}
      {readBySlotMutation.isError && (
        <p className="mb-2 text-sm text-destructive">
          {readBySlotMutation.error instanceof Error
            ? readBySlotMutation.error.message
            : "Read failed"}
        </p>
      )}
      {overviewMutation.isError && (
        <p className="mb-2 text-sm text-destructive">
          {overviewMutation.error instanceof Error
            ? overviewMutation.error.message
            : "Refresh failed"}
        </p>
      )}
      {writeMutation.isError && (
        <p className="mb-2 text-sm text-destructive">
          {writeMutation.error instanceof Error
            ? writeMutation.error.message
            : "Write failed"}
        </p>
      )}

      <div className="mb-4 rounded-lg border bg-card p-2">
        <div className="mb-2 flex items-center gap-2">
          <div className="text-sm font-medium">Navigator</div>
          <div className="text-xs text-muted-foreground">
            {overview
              ? `${String(overview.tracks.length)} tracks · ${String(maxSlots)} slots`
              : "No data"}
          </div>
          {overview && liveSelectedClipId !== null && (
            <div className="ml-auto text-xs text-muted-foreground">
              Live selected clip id: {liveSelectedClipId}
            </div>
          )}
        </div>
        {overview && overview.tracks.length > 0 && maxSlots > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-max space-y-1 pr-2">
              {overview.tracks.map((track, trackIndex) => (
                <div
                  key={track.id}
                  className="grid grid-cols-[12rem_1fr] items-center gap-2"
                >
                  <div className="truncate text-xs text-muted-foreground">
                    {track.name}
                  </div>
                  <div
                    className="grid gap-1"
                    style={{
                      gridTemplateColumns: `repeat(${String(maxSlots)}, 5rem)`,
                    }}
                  >
                    {Array.from({ length: maxSlots }).map((_, slotIndex) => {
                      const slot = track.clip_slots[slotIndex];
                      const clip = slot?.clip ?? null;
                      const clipId = clip?.id ?? null;
                      const isEmpty = !slot?.has_clip || clip === null;
                      const isAppSelected =
                        selectedSlot?.trackIndex === trackIndex &&
                        selectedSlot.slotIndex === slotIndex;
                      const isLiveSelected =
                        clipId !== null && clipId === liveSelectedClipId;
                      return (
                        <button
                          key={slot?.id ?? slotIndex}
                          type="button"
                          disabled={isEmpty || readBySlotMutation.isPending}
                          onClick={() => {
                            if (!clipId) return;
                            setSelectedSlot({ trackIndex, slotIndex, clipId });
                            readBySlotMutation.mutate({
                              data: { trackIndex, slotIndex },
                            });
                          }}
                          className={cn(
                            "h-7 w-20 truncate rounded-md border px-2 text-left text-[11px] leading-6 transition-colors disabled:opacity-40",
                            isEmpty
                              ? "bg-muted/20 text-muted-foreground"
                              : "bg-background hover:bg-muted/40",
                            isLiveSelected &&
                              !isAppSelected &&
                              "border-ring",
                            isAppSelected &&
                              "border-primary bg-primary text-primary-foreground",
                          )}
                          title={
                            clip
                              ? `${clip.name} (${clip.path})`
                              : "Empty slot"
                          }
                        >
                          {clip ? clip.name : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div>Refresh to fetch tracks/slots.</div>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                overviewMutation.mutate();
              }}
              disabled={overviewMutation.isPending}
            >
              <RefreshCw
                className={cn(overviewMutation.isPending && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        )}
      </div>

      <NoteTable
        notes={notes}
        onUpdate={(rowIndex, columnId, value) => {
          setNotes((old) =>
            old.map((row, i) =>
              i === rowIndex ? { ...row, [columnId]: value } : row,
            ),
          );
          const noteId = notes[rowIndex]?.note_id;
          if (noteId !== undefined && noteId > 0) {
            setModifiedNoteIds((prev) => new Set(prev).add(noteId));
          }
        }}
        onDelete={(rowIndex) => {
          const noteId = notes[rowIndex]?.note_id;
          if (noteId !== undefined && noteId > 0) {
            setDeletedNoteIds((prev) => new Set(prev).add(noteId));
          }
          setNotes((old) => old.filter((_, i) => i !== rowIndex));
        }}
      />

      {clipInfo && notes.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {notes.length} notes · {modifiedNoteIds.size} modified ·{" "}
          {deletedNoteIds.size} deleted
        </p>
      )}

      {clipInfo && (
        <ScoreDisplay notes={notes} renderToken={scoreRenderToken} />
      )}
    </div>
  );
}
