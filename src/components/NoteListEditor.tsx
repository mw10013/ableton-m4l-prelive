import type { Note } from "@/lib/Domain";

import { useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useHotkeys } from "@astryxdesign/core/hooks";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";

import { DuplicateNotesDialog } from "@/components/DuplicateNotesDialog";
import { type EditableField, NoteTable } from "@/components/NoteTable";
import { MIN_DURATION } from "@/lib/beatTime";
import { byMusicalOrder, duplicateNotes, nextTempId } from "@/lib/noteEdits";

export type EditorStatus =
  | "idle"
  | "loading"
  | "writing"
  | "reloading"
  | "unverified";

export interface EditorClip {
  id: number;
  signatureNumerator: number;
  signatureDenominator: number;
  playback: { readonly start: number; readonly end: number };
}

interface NoteListEditorProps {
  clip: EditorClip;
  notes: readonly Note[];
  onNotesChange: (notes: readonly Note[]) => void;
  status: EditorStatus;
  writeError: string | null;
  reloadError: string | null;
  onWrite: () => void;
  onReload: () => void;
}

const STATUS_LABEL: Record<EditorStatus, string | null> = {
  idle: null,
  loading: "Loading clip…",
  writing: "Writing to Live…",
  reloading: "Reloading from Live…",
  unverified: "Unverified — reload from Live",
};

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
  clip,
  notes,
  onNotesChange,
  status,
  writeError,
  reloadError,
  onWrite,
  onReload,
}: NoteListEditorProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [multiEditMode, setMultiEditMode] = useState<"relative" | "absolute">(
    "relative",
  );
  const [duplicateSource, setDuplicateSource] = useState<
    readonly Note[] | null
  >(null);
  const isIdle = status === "idle";
  const isDialogOpen = duplicateSource !== null;
  const isEditable = isIdle && !isDialogOpen;
  const selectedNotes = notes.filter((note) =>
    selectedKeys.has(String(note.note_id)),
  );

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
    onNotesChange(
      byMusicalOrder(
        notes.map((note) => (isTarget(note) ? apply(note) : note)),
      ),
    );
  };

  const toggleMute = (noteId: number, mute: boolean) => {
    onNotesChange(
      notes.map((note) => (note.note_id === noteId ? { ...note, mute } : note)),
    );
  };

  const addNote = () => {
    const last = notes.at(-1);
    onNotesChange(
      byMusicalOrder([
        ...notes,
        {
          note_id: nextTempId(notes),
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
    onNotesChange(
      notes.filter((note) => !selectedKeys.has(String(note.note_id))),
    );
    setSelectedKeys(new Set());
  };

  const openDuplicate = () => {
    if (selectedNotes.length > 0) setDuplicateSource(selectedNotes);
  };

  const confirmDuplicate = (destination: number) => {
    if (duplicateSource === null) return;
    const { notes: next, copies } = duplicateNotes({
      notes,
      selected: duplicateSource,
      destination,
    });
    onNotesChange(next);
    setSelectedKeys(new Set(copies.map(({ note_id }) => String(note_id))));
    setDuplicateSource(null);
  };

  useHotkeys([
    {
      keys: "mod+a",
      onPress: () => {
        setSelectedKeys(new Set(notes.map((note) => String(note.note_id))));
      },
      isDisabled: !isEditable || notes.length === 0,
    },
    {
      keys: "mod+d",
      onPress: openDuplicate,
      isDisabled: !isEditable || selectedKeys.size === 0,
    },
    {
      keys: "backspace",
      onPress: deleteSelected,
      isDisabled: !isEditable || selectedKeys.size === 0,
    },
    {
      keys: "delete",
      onPress: deleteSelected,
      isDisabled: !isEditable || selectedKeys.size === 0,
    },
  ]);

  return (
    <>
      <Toolbar
        label="Note list actions"
        size="sm"
        startContent={
          <>
            <Text type="supporting" color="secondary">
              {notes.length} {notes.length === 1 ? "note" : "notes"}
            </Text>
            {STATUS_LABEL[status] !== null && (
              <Text type="supporting" color="secondary">
                {STATUS_LABEL[status]}
              </Text>
            )}
          </>
        }
        endContent={
          <>
            <SegmentedControl
              label="Multi-edit mode"
              value={multiEditMode}
              isDisabled={!isEditable}
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
              isDisabled={!isEditable}
              onClick={addNote}
            />
            <Button
              label="Duplicate..."
              size="sm"
              tooltip="Duplicate selected notes (Cmd/Ctrl-D)"
              isDisabled={!isEditable || selectedKeys.size === 0}
              onClick={openDuplicate}
            />
            <Button
              label={
                selectedKeys.size === 0
                  ? "Delete selected"
                  : `Delete ${String(selectedKeys.size)}`
              }
              size="sm"
              isDisabled={!isEditable || selectedKeys.size === 0}
              onClick={deleteSelected}
            />
            <Button
              label="Reload from Live"
              size="sm"
              isLoading={status === "reloading"}
              isDisabled={isDialogOpen || !(isIdle || status === "unverified")}
              onClick={onReload}
            />
            <Button
              label="Write to Live"
              variant="primary"
              size="sm"
              isLoading={status === "writing"}
              isDisabled={!isEditable}
              onClick={onWrite}
            />
          </>
        }
      />
      <NoteTable
        notes={notes}
        signatureNumerator={clip.signatureNumerator}
        signatureDenominator={clip.signatureDenominator}
        selectedKeys={selectedKeys}
        setSelectedKeys={setSelectedKeys}
        isDisabled={!isEditable}
        onCommitField={commitField}
        onToggleMute={toggleMute}
      />
      {writeError !== null && (
        <Banner
          status="error"
          title="Write failed — Live may hold an empty or partial clip"
          description={`${writeError} Reload from Live to see what the clip actually contains.`}
        />
      )}
      {reloadError !== null && (
        <Banner
          status="error"
          title="Reload failed"
          description={reloadError}
        />
      )}
      {duplicateSource !== null && (
        <DuplicateNotesDialog
          notes={notes}
          selected={duplicateSource}
          signatureNumerator={clip.signatureNumerator}
          signatureDenominator={clip.signatureDenominator}
          playback={clip.playback}
          onClose={() => {
            setDuplicateSource(null);
          }}
          onConfirm={confirmDuplicate}
        />
      )}
    </>
  );
}
