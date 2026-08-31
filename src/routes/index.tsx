import type { TableColumn } from "@astryxdesign/core/Table";

import type { ClipWithNotes, Note } from "@/lib/Domain";

import { useEffect, useState } from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Section } from "@astryxdesign/core/Section";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { pixel, Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import {
  type EditableField,
  MIN_DURATION,
  NoteTable,
} from "@/components/NoteTable";
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

const byMusicalOrder = (notes: readonly Note[]) =>
  notes.toSorted((a, b) => a.start_time - b.start_time || a.pitch - b.pitch);

const clampField = (field: EditableField, value: number): number => {
  switch (field) {
    case "pitch": {
      return Math.round(Math.min(127, Math.max(0, value)));
    }
    case "start_time": {
      return Math.max(0, value);
    }
    case "duration": {
      return Math.max(MIN_DURATION, value);
    }
    case "velocity": {
      return Math.min(127, Math.max(0, value));
    }
  }
};

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [overview, setOverview] = useState<LiveSetOverview | null>(null);
  const [liveSelectedClipId, setLiveSelectedClipId] = useState<number | null>(
    null,
  );
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(true);
  const [baseline, setBaseline] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note[] | null>(null);
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [modifiedNoteIds, setModifiedNoteIds] = useState<Set<number>>(
    new Set(),
  );
  const [deletedNoteIds, setDeletedNoteIds] = useState<Set<number>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [multiEditMode, setMultiEditMode] = useState<"relative" | "absolute">(
    "relative",
  );
  const [scoreRenderToken, setScoreRenderToken] = useState(0);

  const notes = draft ?? baseline;

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
    setBaseline(byMusicalOrder(clip.notes ?? []));
    setDraft(null);
    setModifiedNoteIds(new Set());
    setDeletedNoteIds(new Set());
    setSelectedKeys(new Set());
    setIsNavigatorOpen(false);
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

  const markModified = (noteIds: readonly number[]) => {
    const persisted = noteIds.filter((id) => id > 0);
    if (persisted.length === 0) return;
    setModifiedNoteIds((prev) => new Set([...prev, ...persisted]));
  };

  const commitField = (noteId: number, field: EditableField, next: number) => {
    const current = notes.find((note) => note.note_id === noteId);
    if (current === undefined) return;
    const isGroupEdit =
      selectedKeys.has(String(noteId)) && selectedKeys.size > 1;
    const isTarget = (note: Note) =>
      isGroupEdit
        ? selectedKeys.has(String(note.note_id))
        : note.note_id === noteId;
    const apply = (note: Note): Note => ({
      ...note,
      [field]:
        isGroupEdit && multiEditMode === "relative"
          ? clampField(field, note[field] + next - current[field])
          : clampField(field, next),
    });
    markModified(notes.filter(isTarget).map((note) => note.note_id));
    setDraft(
      byMusicalOrder(
        notes.map((note) => (isTarget(note) ? apply(note) : note)),
      ),
    );
  };

  const toggleMute = (noteId: number, mute: boolean) => {
    markModified([noteId]);
    setDraft(
      notes.map((note) => (note.note_id === noteId ? { ...note, mute } : note)),
    );
  };

  const handleAddNote = () => {
    const last = notes.at(-1);
    setDraft(
      byMusicalOrder([
        ...notes,
        {
          note_id: nextTempId--,
          pitch: last?.pitch ?? 60,
          start_time: last === undefined ? 0 : last.start_time + last.duration,
          duration: last?.duration ?? 1,
          velocity: last?.velocity ?? 100,
          mute: false,
          probability: 1,
          velocity_deviation: 0,
          release_velocity: 64,
        },
      ]),
    );
  };

  const deleteSelected = () => {
    if (selectedKeys.size === 0) return;
    const removed = notes.filter((note) =>
      selectedKeys.has(String(note.note_id)),
    );
    setDeletedNoteIds(
      (prev) =>
        new Set([
          ...prev,
          ...removed.map((note) => note.note_id).filter((id) => id > 0),
        ]),
    );
    setDraft(notes.filter((note) => !selectedKeys.has(String(note.note_id))));
    setSelectedKeys(new Set());
  };

  const discardEdits = () => {
    setDraft(null);
    setModifiedNoteIds(new Set());
    setDeletedNoteIds(new Set());
    setSelectedKeys(new Set());
  };

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

  useHotkeys([
    {
      keys: "mod+a",
      onPress: () => {
        setSelectedKeys(new Set(notes.map((note) => String(note.note_id))));
      },
      isDisabled: notes.length === 0,
    },
    {
      keys: "backspace",
      onPress: deleteSelected,
      isDisabled: selectedKeys.size === 0,
    },
    {
      keys: "delete",
      onPress: deleteSelected,
      isDisabled: selectedKeys.size === 0,
    },
  ]);

  const maxSlots =
    overview?.tracks.reduce(
      (m, t) => (t.clip_slots.length > m ? t.clip_slots.length : m),
      0,
    ) ?? 0;

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

  const navigatorError = [
    { mutation: overviewMutation, title: "Refresh failed" },
    { mutation: readMutation, title: "Read failed" },
    { mutation: readBySlotMutation, title: "Read failed" },
  ].find(({ mutation }) => mutation.isError);

  const editorError = [
    { mutation: writeMutation, title: "Write failed" },
    { mutation: fireClipMutation, title: "Play clip failed" },
  ].find(({ mutation }) => mutation.isError);

  const hasDraft = draft !== null;

  return (
    <AppShell
      height="auto"
      contentPadding={4}
      topNav={
        <TopNav
          heading={
            <TopNavHeading heading="prelive" subheading="Ableton Live clips" />
          }
        />
      }
    >
      <VStack gap={4} width="100%" maxWidth={1152} xstyle={xs.column}>
        <Section paddingBlock={2}>
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
                  <Button
                    label="Read from Live"
                    variant="primary"
                    size="sm"
                    isLoading={readMutation.isPending}
                    onClick={() => {
                      readMutation.mutate();
                    }}
                  />
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
            <Collapsible
              isOpen={isNavigatorOpen}
              onOpenChange={setIsNavigatorOpen}
              trigger={
                <Text type="supporting" color="secondary">
                  {isNavigatorOpen ? "Hide tracks" : "Show tracks"}
                  {liveSelectedClipId !== null &&
                    ` · Live selected clip id ${String(liveSelectedClipId)}`}
                </Text>
              }
            >
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
            </Collapsible>
            {navigatorError && (
              <Banner
                status="error"
                title={navigatorError.title}
                description={
                  navigatorError.mutation.error instanceof Error
                    ? navigatorError.mutation.error.message
                    : navigatorError.title
                }
              />
            )}
          </VStack>
        </Section>

        {clipInfo && (
          <Section paddingBlock={2}>
            <VStack gap={2}>
              <Toolbar
                label="Clip"
                size="sm"
                dividers={["bottom"]}
                startContent={
                  <>
                    <Text type="label" maxLines={1}>
                      {trackName && `${trackName} / `}
                      {clipInfo.name || "Untitled"}
                    </Text>
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {clipInfo.path} · {clipInfo.length} beats ·{" "}
                      {clipInfo.signatureNumerator}/
                      {clipInfo.signatureDenominator}
                    </Text>
                  </>
                }
                endContent={
                  <>
                    <Text type="supporting" color="secondary">
                      Space toggles playback
                    </Text>
                    <Button
                      label="Play Clip"
                      size="sm"
                      isDisabled={notes.length === 0}
                      isLoading={fireClipMutation.isPending}
                      onClick={() => {
                        fireClipMutation.mutate({
                          data: { clipId: clipInfo.id },
                        });
                      }}
                    />
                  </>
                }
              />
              <Toolbar
                label="Note list actions"
                size="sm"
                startContent={
                  <Text type="supporting" color="secondary">
                    {notes.length} {notes.length === 1 ? "note" : "notes"}
                    {hasDraft &&
                      ` · ${String(modifiedNoteIds.size)} modified · ${String(deletedNoteIds.size)} deleted`}
                  </Text>
                }
                endContent={
                  <>
                    <SegmentedControl
                      label="Multi-edit mode"
                      value={multiEditMode}
                      onChange={(value) => {
                        setMultiEditMode(
                          value === "absolute" ? "absolute" : "relative",
                        );
                      }}
                    >
                      <SegmentedControlItem value="relative" label="Relative" />
                      <SegmentedControlItem value="absolute" label="Absolute" />
                    </SegmentedControl>
                    <Button
                      label="Add note"
                      size="sm"
                      onClick={handleAddNote}
                    />
                    <Button
                      label={
                        selectedKeys.size === 0
                          ? "Delete selected"
                          : `Delete ${String(selectedKeys.size)}`
                      }
                      size="sm"
                      isDisabled={selectedKeys.size === 0}
                      onClick={deleteSelected}
                    />
                    <Button
                      label="Discard edits"
                      size="sm"
                      isDisabled={!hasDraft}
                      onClick={discardEdits}
                    />
                    <Button
                      label="Write to Live"
                      variant="primary"
                      size="sm"
                      isDisabled={!hasDraft}
                      isLoading={writeMutation.isPending}
                      onClick={handleWrite}
                    />
                  </>
                }
              />
              <NoteTable
                notes={notes}
                signatureNumerator={clipInfo.signatureNumerator}
                signatureDenominator={clipInfo.signatureDenominator}
                selectedKeys={selectedKeys}
                setSelectedKeys={setSelectedKeys}
                onCommitField={commitField}
                onToggleMute={toggleMute}
              />
              {editorError && (
                <Banner
                  status="error"
                  title={editorError.title}
                  description={
                    editorError.mutation.error instanceof Error
                      ? editorError.mutation.error.message
                      : editorError.title
                  }
                />
              )}
            </VStack>
          </Section>
        )}

        {clipInfo && notes.length > 0 && (
          <Section paddingBlock={2}>
            <VStack gap={2}>
              <Toolbar
                label="Score"
                size="sm"
                startContent={
                  <>
                    <Text type="label">Score</Text>
                    {hasDraft && (
                      <>
                        <StatusDot variant="warning" label="Score is stale" />
                        <Text type="supporting" color="secondary">
                          Unsent edits — refresh to update
                        </Text>
                      </>
                    )}
                  </>
                }
                endContent={
                  <Button
                    label="Refresh score"
                    size="sm"
                    onClick={() => {
                      setScoreRenderToken((prev) => prev + 1);
                    }}
                  />
                }
              />
              <ScoreDisplay notes={notes} renderToken={scoreRenderToken} />
            </VStack>
          </Section>
        )}
      </VStack>
    </AppShell>
  );
}
