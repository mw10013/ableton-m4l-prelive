import type { TableColumn } from "@astryxdesign/core/Table";

import type { EditorStatus } from "@/components/NoteListEditor";
import type {
  ClipRegion,
  ClipWithNotes,
  ReplaceNotesInput,
} from "@/lib/Domain";
import type { NoteRow } from "@/lib/noteEdits";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Section } from "@astryxdesign/core/Section";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { pixel, Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import * as stylex from "@stylexjs/stylex";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { NoteListEditor } from "@/components/NoteListEditor";
import { ScorePanel } from "@/components/ScorePanel";
import { ScrubbableNumberInput } from "@/components/ScrubbableNumberInput";
import { useAutowrite } from "@/components/useAutowrite";
import {
  activeRowsOf,
  buffersReducer,
  EMPTY_BUFFERS,
  slotSummaryOf,
} from "@/lib/clipBuffers";
import {
  isSameRegion,
  playbackRegion,
  quartersPerBar,
  requiredPlaybackRegion,
} from "@/lib/noteEdits";
import {
  fireClip,
  readClip,
  readClipById,
  readClipBySlot,
  readLiveSetOverview,
  replaceNotes,
  togglePlay,
} from "@/lib/serverFns";

interface ClipInfo {
  id: number;
  name: string;
  path: string;
  length: number;
  isMidiClip: boolean;
  looping: boolean;
  signatureNumerator: number;
  signatureDenominator: number;
  playback: { readonly start: number; readonly end: number };
}

type ClipSource =
  | { kind: "detail" }
  | { kind: "slot"; trackIndex: number; slotIndex: number };

interface ClipReadResult {
  clip: ClipWithNotes | null;
  trackName: string | null;
  liveSelectedClipId: number | null;
}

type LiveSetOverview = Awaited<
  ReturnType<typeof readLiveSetOverview>
>["live_set"];

interface TrackRow extends Record<string, unknown> {
  trackIndex: number;
  name: string;
  clipSlots: LiveSetOverview["tracks"][number]["clip_slots"];
}

const xs = stylex.create({
  column: {
    marginInline: "auto",
  },
});

const sameSource = (a: ClipSource, b: ClipSource) =>
  a.kind === "detail"
    ? b.kind === "detail"
    : b.kind === "slot" &&
      a.trackIndex === b.trackIndex &&
      a.slotIndex === b.slotIndex;

const clipInfoOf = (clip: ClipWithNotes): ClipInfo => ({
  id: clip.id,
  name: clip.name,
  path: clip.path,
  length: clip.length,
  isMidiClip: clip.is_midi_clip,
  looping: clip.looping,
  signatureNumerator: clip.signature_numerator,
  signatureDenominator: clip.signature_denominator,
  playback: playbackRegion(clip),
});

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const overviewQueryOptions = queryOptions({
  queryKey: ["liveSetOverview"],
  queryFn: () => readLiveSetOverview(),
  retry: false,
  refetchOnWindowFocus: false,
});

const clipQueryOptions = (source: ClipSource) =>
  queryOptions({
    queryKey: ["clip", source],
    queryFn: async (): Promise<ClipReadResult> => {
      if (source.kind === "detail") {
        const data = await readClip();
        return {
          clip: data.live_set.view.detail_clip,
          trackName: data.live_set.view.selected_track?.name ?? null,
          liveSelectedClipId: data.live_set.view.detail_clip?.id ?? null,
        };
      }
      const data = await readClipBySlot({
        data: { trackIndex: source.trackIndex, slotIndex: source.slotIndex },
      });
      return {
        clip: data.live_set.track?.clip_slot?.clip ?? null,
        trackName: data.live_set.track?.name ?? null,
        liveSelectedClipId: null,
      };
    },
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) =>
    queryClient.query(overviewQueryOptions).catch(() => null),
  component: RouteComponent,
});

function RouteComponent() {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery(overviewQueryOptions);
  const [clipSource, setClipSource] = useState<ClipSource | null>(null);
  const clipQuery = useQuery({
    ...clipQueryOptions(clipSource ?? { kind: "detail" }),
    enabled: clipSource !== null,
  });
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(true);
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [loadId, setLoadId] = useState(0);
  const [switchCount, setSwitchCount] = useState(0);
  const [buffers, dispatch] = useReducer(buffersReducer, EMPTY_BUFFERS);
  const notes = activeRowsOf(buffers);
  const slots = slotSummaryOf(buffers);
  const [isClipMissing, setIsClipMissing] = useState(false);
  const [scrubPrototypeValue, setScrubPrototypeValue] = useState(64);
  const [scrubPrototypeDuration, setScrubPrototypeDuration] = useState(1);
  const [scrubLockedValue, setScrubLockedValue] = useState(64);
  const [scrubLockedDuration, setScrubLockedDuration] = useState(1);
  const [scrubLastCommit, setScrubLastCommit] = useState<string | null>(null);

  const overview = overviewQuery.data?.live_set ?? null;
  const liveSelectedClipId =
    clipSource?.kind === "detail" &&
    clipQuery.dataUpdatedAt > overviewQuery.dataUpdatedAt
      ? (clipQuery.data?.liveSelectedClipId ?? null)
      : (overview?.view.detail_clip?.id ?? null);

  /** Load, reload and clip switch: all three buffers take the clip and the editor remounts. */
  const loadClip = useCallback((clip: ClipWithNotes) => {
    setClipInfo(clipInfoOf(clip));
    dispatch({ type: "load", notes: clip.get_all_notes_extended?.notes ?? [] });
    setLoadId((prev) => prev + 1);
    setEditorRevision((prev) => prev + 1);
  }, []);

  const reloadMutation = useMutation({
    mutationFn: readClipById,
    onSuccess: ({ clip }) => {
      if (clip === null) {
        setClipInfo(null);
        dispatch({ type: "load", notes: [] });
        setLoadId((prev) => prev + 1);
        setIsClipMissing(true);
        return;
      }
      if (clip.id === clipInfo?.id) loadClip(clip);
    },
  });

  const { reset: resetReload } = reloadMutation;

  const applyClip = useCallback(
    ({
      clip,
      trackName,
    }: {
      clip: ClipWithNotes;
      trackName: string | null;
    }) => {
      resetReload();
      setIsClipMissing(false);
      setTrackName(trackName);
      loadClip(clip);
      setIsNavigatorOpen(false);
    },
    [loadClip, resetReload],
  );

  /**
   * Reserves row ids. The range is derived from the state read before the dispatch, and React
   * batches the `mint` with the `edit` that follows in the same event, so the ids are deterministic.
   */
  const mintRowIds = useCallback(
    (count: number): readonly number[] => {
      const first = buffers.nextId;
      dispatch({ type: "mint", count });
      return Array.from({ length: count }, (_, index) => first + index);
    },
    [buffers.nextId],
  );

  const onNotesChange = useCallback((rows: readonly NoteRow[]) => {
    dispatch({ type: "edit", rows });
  }, []);

  /** The playback region a write must set, or `undefined` when the current one already fits. */
  const writeRegion = useMemo((): ClipRegion | undefined => {
    if (clipInfo === null) return undefined;
    const region = requiredPlaybackRegion({
      notes,
      region: clipInfo.playback,
      quartersPerBar: quartersPerBar(
        clipInfo.signatureNumerator,
        clipInfo.signatureDenominator,
      ),
    });
    return isSameRegion(region, clipInfo.playback)
      ? undefined
      : { looping: clipInfo.looping, ...region };
  }, [clipInfo, notes]);

  const write = useCallback(
    (input: ReplaceNotesInput) => replaceNotes({ data: input }),
    [],
  );

  const autowrite = useAutowrite({
    clipId: clipInfo?.id ?? 0,
    loadId,
    rows: notes,
    region: writeRegion,
    write,
  });
  const { flushNow } = autowrite;

  // A slot switch is heard at once: flush after the render that shows the new active rows.
  useEffect(() => {
    if (switchCount > 0) flushNow();
  }, [switchCount, flushNow]);

  const switchSlot = () => {
    dispatch({ type: "switch" });
    setEditorRevision((prev) => prev + 1);
    setSwitchCount((prev) => prev + 1);
  };

  useEffect(() => {
    const result = clipQuery.data;
    if (result === undefined || result.clip === null) return;
    applyClip({ clip: result.clip, trackName: result.trackName });
  }, [clipQuery.data, applyClip]);

  const editorStatus: EditorStatus =
    (
      [
        ["reloading", reloadMutation.isPending],
        ["loading", clipQuery.isFetching],
      ] as const
    ).find(([, isActive]) => isActive)?.[0] ?? "idle";
  const isClipBusy = editorStatus !== "idle";

  const selectClipSource = (next: ClipSource) => {
    if (clipSource !== null && sameSource(clipSource, next)) {
      void queryClient.invalidateQueries({
        queryKey: clipQueryOptions(next).queryKey,
      });
      return;
    }
    setClipSource(next);
  };

  const refreshOverview = () => {
    void queryClient.invalidateQueries({
      queryKey: overviewQueryOptions.queryKey,
    });
  };

  const { mutate: togglePlayMutate, isPending: isTogglePlayPending } =
    useMutation({ mutationFn: () => togglePlay() });

  const fireClipMutation = useMutation({ mutationFn: fireClip });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("dialog") !== null ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))
      )
        return;
      event.preventDefault();
      if (!isTogglePlayPending) {
        togglePlayMutate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [isTogglePlayPending, togglePlayMutate]);

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
            clipSource?.kind === "slot" &&
            clipSource.trackIndex === row.trackIndex &&
            clipSource.slotIndex === slotIndex;
          return (
            <ToggleButton
              size="sm"
              label={clip.name || "Clip"}
              tooltip={`${clip.name} (${clip.path})`}
              isPressed={isAppSelected}
              isDisabled={isClipBusy}
              icon={
                clip.id === liveSelectedClipId ? (
                  <Icon icon="check" color="inherit" />
                ) : undefined
              }
              onPressedChange={() => {
                selectClipSource({
                  kind: "slot",
                  trackIndex: row.trackIndex,
                  slotIndex,
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
    { title: "Refresh failed", query: overviewQuery },
    { title: "Read failed", query: clipQuery },
  ].find(({ query }) => query.isError);

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
          <VStack gap={2} maxWidth={640}>
            <Text type="label">Numeric scrub prototype</Text>
            <HStack gap={2} width="100%" wrap="wrap">
              <StackItem size="fill">
                <ScrubbableNumberInput
                  label="Velocity"
                  description="Drag vertically. Shift for fine steps, Escape to cancel, release to commit; click to type."
                  value={scrubPrototypeValue}
                  min={0}
                  max={127}
                  step={1}
                  isIntegerOnly
                  width="100%"
                  onChange={setScrubPrototypeValue}
                  onCommit={(v) => {
                    setScrubLastCommit(`Velocity ${String(v)}`);
                  }}
                />
              </StackItem>
              <StackItem size="fill">
                <ScrubbableNumberInput
                  label="Duration"
                  description="Fractional step, plain pointer capture."
                  value={scrubPrototypeDuration}
                  min={0.25}
                  max={16}
                  step={0.25}
                  width="100%"
                  onChange={setScrubPrototypeDuration}
                  onCommit={(v) => {
                    setScrubLastCommit(`Duration ${String(v)}`);
                  }}
                />
              </StackItem>
            </HStack>
            <HStack gap={2} width="100%" wrap="wrap">
              <StackItem size="fill">
                <ScrubbableNumberInput
                  label="Velocity (pointer lock)"
                  description="Same gesture; the cursor hides while dragging and range is unlimited."
                  value={scrubLockedValue}
                  min={0}
                  max={127}
                  step={1}
                  isIntegerOnly
                  width="100%"
                  pointerLock
                  onChange={setScrubLockedValue}
                  onCommit={(v) => {
                    setScrubLastCommit(`Velocity (lock) ${String(v)}`);
                  }}
                />
              </StackItem>
              <StackItem size="fill">
                <ScrubbableNumberInput
                  label="Duration (pointer lock)"
                  description="Fractional step with pointer lock."
                  value={scrubLockedDuration}
                  min={0.25}
                  max={16}
                  step={0.25}
                  width="100%"
                  pointerLock
                  onChange={setScrubLockedDuration}
                  onCommit={(v) => {
                    setScrubLastCommit(`Duration (lock) ${String(v)}`);
                  }}
                />
              </StackItem>
            </HStack>
            <Text type="supporting">
              {scrubLastCommit === null
                ? "No commit yet."
                : `Last commit: ${scrubLastCommit}`}
            </Text>
          </VStack>
        </Section>
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
                    isLoading={clipQuery.isFetching}
                    isDisabled={isClipBusy}
                    onClick={() => {
                      selectClipSource({ kind: "detail" });
                    }}
                  />
                  <IconButton
                    label="Refresh"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={RefreshCw} color="inherit" />}
                    isLoading={overviewQuery.isFetching}
                    onClick={refreshOverview}
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
                      isLoading={overviewQuery.isFetching}
                      onClick={refreshOverview}
                    />
                  }
                />
              )}
            </Collapsible>
            {isClipMissing && (
              <Banner
                status="warning"
                title="Clip is gone"
                description="Live no longer has that clip. Pick another one from the navigator."
              />
            )}
            {navigatorError && (
              <Banner
                status="error"
                title={navigatorError.title}
                description={
                  navigatorError.query.error instanceof Error
                    ? navigatorError.query.error.message
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
                      isDisabled={notes.length === 0 || isClipBusy}
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
              {clipInfo.isMidiClip ? (
                <NoteListEditor
                  key={editorRevision}
                  clip={{
                    id: clipInfo.id,
                    signatureNumerator: clipInfo.signatureNumerator,
                    signatureDenominator: clipInfo.signatureDenominator,
                    playback: clipInfo.playback,
                  }}
                  notes={notes}
                  onNotesChange={onNotesChange}
                  mintRowIds={mintRowIds}
                  status={editorStatus}
                  autowrite={autowrite}
                  slots={slots}
                  reloadError={
                    reloadMutation.isError
                      ? messageOf(reloadMutation.error, "Reload failed.")
                      : null
                  }
                  onSwitchSlot={switchSlot}
                  onCopyToOther={() => {
                    dispatch({ type: "copyToOther" });
                  }}
                  onRevert={() => {
                    dispatch({ type: "revert" });
                  }}
                  onSetBaseline={() => {
                    dispatch({ type: "setBaseline" });
                  }}
                  onReload={() => {
                    reloadMutation.mutate({
                      data: { clipId: clipInfo.id },
                    });
                  }}
                />
              ) : (
                <EmptyState
                  isCompact
                  title="Audio clip"
                  description="Only MIDI clips have a note list."
                />
              )}
              {fireClipMutation.isError && (
                <Banner
                  status="error"
                  title="Play clip failed"
                  description={
                    fireClipMutation.error instanceof Error
                      ? fireClipMutation.error.message
                      : "Play clip failed"
                  }
                />
              )}
            </VStack>
          </Section>
        )}

        {clipInfo?.isMidiClip && notes.length > 0 && (
          <ScorePanel key={editorRevision} notes={notes} />
        )}
      </VStack>
    </AppShell>
  );
}
