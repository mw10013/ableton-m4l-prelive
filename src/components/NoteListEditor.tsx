import type { ClipWithNotes, Note } from "@/lib/Domain";

import { useEffect, useEffectEvent, useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useHotkeys } from "@astryxdesign/core/hooks";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type EditableField,
  MIN_DURATION,
  NoteTable,
} from "@/components/NoteTable";
import { writeNotes } from "@/lib/serverFns";

export interface NoteListEditorState {
  readonly notes: readonly Note[];
  readonly hasDraft: boolean;
}

interface NoteListEditorProps {
  clipId: number;
  initialNotes: readonly Note[];
  signatureNumerator: number;
  signatureDenominator: number;
  onStateChange: (state: NoteListEditorState) => void;
}

let nextTempId = -1;

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

export function NoteListEditor({
  clipId,
  initialNotes,
  signatureNumerator,
  signatureDenominator,
  onStateChange,
}: NoteListEditorProps) {
  const queryClient = useQueryClient();
  const [baseline] = useState<readonly Note[]>(initialNotes);
  const [draft, setDraft] = useState<Note[] | null>(null);
  const [modifiedNoteIds, setModifiedNoteIds] = useState<Set<number>>(
    new Set(),
  );
  const [deletedNoteIds, setDeletedNoteIds] = useState<Set<number>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [multiEditMode, setMultiEditMode] = useState<"relative" | "absolute">(
    "relative",
  );
  const notes = draft ?? baseline;
  const hasDraft = draft !== null;
  const emitStateChange = useEffectEvent(onStateChange);

  useEffect(() => {
    emitStateChange({ notes, hasDraft });
  }, [notes, hasDraft]);

  const writeMutation = useMutation({
    mutationFn: writeNotes,
    onSuccess: ({ clip }) => {
      queryClient.setQueriesData<{ clip: ClipWithNotes | null }>(
        { queryKey: ["clip"] },
        (current) =>
          current?.clip?.id === clip.id ? { ...current, clip } : current,
      );
    },
  });

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

  const addNote = () => {
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

  const writeToLive = () => {
    writeMutation.mutate({
      data: {
        clipId,
        newNotes: notes
          .filter((note) => note.note_id < 0)
          .map(({ note_id: _, ...note }) => note),
        modifiedNotes: notes.filter(
          (note) => modifiedNoteIds.has(note.note_id) && note.note_id > 0,
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

  return (
    <>
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
            <Button label="Add note" size="sm" onClick={addNote} />
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
              onClick={writeToLive}
            />
          </>
        }
      />
      <NoteTable
        notes={notes}
        signatureNumerator={signatureNumerator}
        signatureDenominator={signatureDenominator}
        selectedKeys={selectedKeys}
        setSelectedKeys={setSelectedKeys}
        onCommitField={commitField}
        onToggleMute={toggleMute}
      />
      {writeMutation.isError && (
        <Banner
          status="error"
          title="Write failed"
          description={
            writeMutation.error instanceof Error
              ? writeMutation.error.message
              : "Write failed"
          }
        />
      )}
    </>
  );
}
