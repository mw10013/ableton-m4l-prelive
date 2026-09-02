import type { TableColumn } from "@astryxdesign/core/Table";

import type { ClipWithNotes } from "@/lib/Domain";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Section } from "@astryxdesign/core/Section";
import { VStack } from "@astryxdesign/core/Stack";
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

import {
  NoteListEditor,
  type NoteListEditorState,
} from "@/components/NoteListEditor";
import { ScorePanel } from "@/components/ScorePanel";
import {
  fireClip,
  readClip,
  readClipBySlot,
  readLiveSetOverview,
  togglePlay,
} from "@/lib/serverFns";

interface ClipInfo {
  id: number;
  name: string;
  path: string;
  length: number;
  signatureNumerator: number;
  signatureDenominator: number;
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
  const [editorState, setEditorState] = useState<NoteListEditorState>({
    notes: [],
    hasDraft: false,
  });

  const overview = overviewQuery.data?.live_set ?? null;
  const liveSelectedClipId =
    clipSource?.kind === "detail" &&
    clipQuery.dataUpdatedAt > overviewQuery.dataUpdatedAt
      ? (clipQuery.data?.liveSelectedClipId ?? null)
      : (overview?.view.detail_clip?.id ?? null);

  const applyClip = useCallback(
    ({
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
      setEditorState({
        notes:
          clip.get_all_notes_extended?.notes.toSorted(
            (a, b) => a.start_time - b.start_time || a.pitch - b.pitch,
          ) ?? [],
        hasDraft: false,
      });
      setEditorRevision((prev) => prev + 1);
      setIsNavigatorOpen(false);
    },
    [],
  );

  useEffect(() => {
    const result = clipQuery.data;
    if (result === undefined || result.clip === null) return;
    applyClip({ clip: result.clip, trackName: result.trackName });
  }, [clipQuery.data, applyClip]);

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
              isDisabled={clipQuery.isFetching}
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
                      isDisabled={editorState.notes.length === 0}
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
              <NoteListEditor
                key={editorRevision}
                clipId={clipInfo.id}
                initialNotes={editorState.notes}
                signatureNumerator={clipInfo.signatureNumerator}
                signatureDenominator={clipInfo.signatureDenominator}
                onStateChange={setEditorState}
              />
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

        {clipInfo && editorState.notes.length > 0 && (
          <ScorePanel key={editorRevision} notes={editorState.notes} />
        )}
      </VStack>
    </AppShell>
  );
}
