import type { TableColumn } from "@astryxdesign/core/Table";

import type { ClipWithNotes, Note } from "@/lib/Domain";

import { useEffect, useState } from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Stack";
import { pixel, Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { NoteTable } from "@/components/NoteTable";
import { ScoreDisplay } from "@/components/ScoreDisplay";
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

type LiveSetOverview = Awaited<
  ReturnType<typeof readLiveSetOverview>
>["live_set"];

interface TrackRow extends Record<string, unknown> {
  trackIndex: number;
  name: string;
  clipSlots: LiveSetOverview["tracks"][number]["clip_slots"];
}

let nextTempId = -1;

const xs = stylex.create({
  column: {
    marginInline: "auto",
  },
});

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
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))
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

  const mutationErrors = [
    { mutation: readMutation, title: "Read failed" },
    { mutation: readBySlotMutation, title: "Read failed" },
    { mutation: overviewMutation, title: "Refresh failed" },
    { mutation: writeMutation, title: "Write failed" },
  ];

  const navigatorColumns: TableColumn<TrackRow>[] = [
    {
      key: "name",
      header: "Track",
      width: pixel(160),
      renderCell: (row) => (
        <Text type="supporting" color="secondary" maxLines={1}>
          {row.name}
        </Text>
      ),
    },
    ...Array.from(
      { length: maxSlots },
      (_, slotIndex): TableColumn<TrackRow> => ({
        key: `slot_${String(slotIndex)}`,
        header: String(slotIndex + 1),
        width: pixel(112),
        renderCell: (row) => {
          const slot = row.clipSlots[slotIndex];
          const clip = slot?.clip ?? null;
          if (!slot?.has_clip || clip === null) return null;
          const isAppSelected =
            selectedSlot?.trackIndex === row.trackIndex &&
            selectedSlot.slotIndex === slotIndex;
          return (
            <ToggleButton
              size="sm"
              label={clip.name || "Clip"}
              tooltip={`${clip.name} (${clip.path})`}
              isPressed={isAppSelected}
              isDisabled={readBySlotMutation.isPending}
              icon={
                clip.id === liveSelectedClipId ? (
                  <Icon icon="check" color="inherit" />
                ) : undefined
              }
              onPressedChange={() => {
                setSelectedSlot({
                  trackIndex: row.trackIndex,
                  slotIndex,
                  clipId: clip.id,
                });
                readBySlotMutation.mutate({
                  data: { trackIndex: row.trackIndex, slotIndex },
                });
              }}
            >
              {clip.name || "Clip"}
            </ToggleButton>
          );
        },
      }),
    ),
  ];

  return (
    <AppShell
      height="auto"
      contentPadding={4}
      topNav={
        <TopNav
          heading={
            <TopNavHeading heading="prelive" subheading="Ableton Live clips" />
          }
          endContent={
            clipInfo && (
              <Text type="supporting" color="secondary" maxLines={1}>
                {trackName && <>{trackName} / </>}
                {clipInfo.name} — {clipInfo.path} ({clipInfo.length} beats)
              </Text>
            )
          }
        />
      }
    >
      <VStack gap={4} width="100%" maxWidth={1152} xstyle={xs.column}>
        <Toolbar
          label="Clip actions"
          gap={2}
          startContent={
            <>
              <Button
                label="Read from Live"
                variant="primary"
                isLoading={readMutation.isPending}
                onClick={() => {
                  readMutation.mutate();
                }}
              />
              <Button
                label="Preview Score"
                isDisabled={!clipInfo || notes.length === 0}
                onClick={() => {
                  setScoreRenderToken((prev) => prev + 1);
                }}
              />
              <Button
                label="Write to Live"
                isDisabled={!clipInfo}
                isLoading={writeMutation.isPending}
                onClick={handleWrite}
              />
              <Button
                label="Add Note"
                variant="ghost"
                isDisabled={!clipInfo}
                onClick={handleAddNote}
              />
              <Button
                label="Play Clip"
                isDisabled={!clipInfo || notes.length === 0}
                isLoading={fireClipMutation.isPending}
                onClick={() => {
                  if (clipInfo)
                    fireClipMutation.mutate({ data: { clipId: clipInfo.id } });
                }}
              />
            </>
          }
        />

        {mutationErrors.map(
          ({ mutation, title }) =>
            mutation.isError && (
              <Banner
                key={title}
                status="error"
                title={title}
                description={
                  mutation.error instanceof Error
                    ? mutation.error.message
                    : title
                }
              />
            ),
        )}

        <Card padding={2}>
          <VStack gap={2}>
            <Toolbar
              label="Navigator"
              size="sm"
              startContent={
                <>
                  <Text type="label">Navigator</Text>
                  <Text type="supporting" color="secondary">
                    {overview
                      ? `${String(overview.tracks.length)} tracks · ${String(maxSlots)} slots`
                      : "No data"}
                  </Text>
                </>
              }
              endContent={
                <>
                  {overview && liveSelectedClipId !== null && (
                    <Text type="supporting" color="secondary">
                      Live selected clip id: {liveSelectedClipId}
                    </Text>
                  )}
                  <IconButton
                    label="Refresh"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={RefreshCw} color="inherit" />}
                    isLoading={overviewMutation.isPending}
                    onClick={() => {
                      overviewMutation.mutate();
                    }}
                  />
                </>
              }
            />
            {overview && overview.tracks.length > 0 && maxSlots > 0 ? (
              <Table
                data={overview.tracks.map(
                  (track, trackIndex): TrackRow => ({
                    trackIndex,
                    name: track.name,
                    clipSlots: track.clip_slots,
                  }),
                )}
                idKey="trackIndex"
                density="compact"
                columns={navigatorColumns}
              />
            ) : (
              <EmptyState
                isCompact
                title="No data"
                description="Refresh to fetch tracks and slots."
                actions={
                  <Button
                    label="Refresh"
                    size="sm"
                    icon={<Icon icon={RefreshCw} color="inherit" />}
                    isLoading={overviewMutation.isPending}
                    onClick={() => {
                      overviewMutation.mutate();
                    }}
                  />
                }
              />
            )}
          </VStack>
        </Card>

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
          <Text type="supporting" color="secondary">
            {notes.length} notes · {modifiedNoteIds.size} modified ·{" "}
            {deletedNoteIds.size} deleted
          </Text>
        )}

        {clipInfo && (
          <ScoreDisplay notes={notes} renderToken={scoreRenderToken} />
        )}
      </VStack>
    </AppShell>
  );
}
