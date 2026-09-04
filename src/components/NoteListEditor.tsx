import type { TableContextAction } from "@astryxdesign/core/Table";

import type { Note } from "@/lib/Domain";
import type { EditableField } from "@/lib/noteEdits";

import { useEffect, useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { SlidersHorizontal } from "lucide-react";

import { DuplicateNotesDialog } from "@/components/DuplicateNotesDialog";
import { type CommitMode, NoteTable } from "@/components/NoteTable";
import {
  FIELD_LABEL,
  type SettableField,
  SetNoteFieldDialog,
} from "@/components/SetNoteFieldDialog";
import {
  byMusicalOrder,
  duplicateNotes,
  nextTempId,
  setField,
  shiftField,
} from "@/lib/noteEdits";

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

const DETAILS_STORAGE_KEY = "prelive.noteList.showDetails";

const SETTABLE_FIELDS: readonly SettableField[] = [
  "pitch",
  "duration",
  "velocity",
  "probability",
  "velocity_deviation",
  "release_velocity",
];

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
  const [showDetails, setShowDetails] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<
    readonly Note[] | null
  >(null);
  const [setFieldTarget, setSetFieldTarget] = useState<{
    readonly field: SettableField;
    readonly notes: readonly Note[];
  } | null>(null);
  const isIdle = status === "idle";
  const isDialogOpen = duplicateSource !== null || setFieldTarget !== null;
  const isEditable = isIdle && !isDialogOpen;
  const selectedNotes = notes.filter((note) =>
    selectedKeys.has(String(note.note_id)),
  );

  // Read after mount: the server render has no localStorage, and a differing first client render
  // would be a hydration mismatch.
  useEffect(() => {
    try {
      setShowDetails(localStorage.getItem(DETAILS_STORAGE_KEY) === "true");
    } catch {
      // Storage blocked; keep the default.
    }
  }, []);
  const toggleDetails = (next: boolean) => {
    setShowDetails(next);
    try {
      localStorage.setItem(DETAILS_STORAGE_KEY, String(next));
    } catch {
      // Storage blocked; the toggle still works for this page.
    }
  };

  /** The edited row plus, when it is part of a multi-row selection, every other selected row. */
  const editTargets = (noteId: number): ReadonlySet<number> =>
    selectedKeys.has(String(noteId)) && selectedKeys.size > 1
      ? new Set(selectedNotes.map((note) => note.note_id))
      : new Set([noteId]);

  /**
   * A single-row edit and an absolute group edit both set the value. A relative group edit moves
   * every target by the edited row's delta, stopping the whole group at the first bound (see
   * `shiftField`). Absolute on a multi-row selection is reached with Cmd/Ctrl held on the commit
   * (Cubase's gesture) or through the Set... row actions.
   */
  const commitField = (
    noteId: number,
    field: EditableField,
    next: number,
    mode: CommitMode,
  ) => {
    const current = notes.find((note) => note.note_id === noteId);
    if (current === undefined) return;
    const targets = editTargets(noteId);
    onNotesChange(
      targets.size > 1 && mode === "relative"
        ? shiftField(notes, targets, field, next - current[field])
        : setField(notes, targets, field, next),
    );
  };

  const setMute = (targetIds: ReadonlySet<number>, mute: boolean) => {
    onNotesChange(
      notes.map((note) =>
        targetIds.has(note.note_id) ? { ...note, mute } : note,
      ),
    );
  };

  const toggleMute = (noteId: number, mute: boolean) => {
    setMute(editTargets(noteId), mute);
  };

  const toggleSelectedMute = () => {
    if (selectedNotes.length === 0) return;
    setMute(
      new Set(selectedNotes.map((note) => note.note_id)),
      !selectedNotes.every((note) => note.mute),
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

  const confirmSetField = (value: number) => {
    if (setFieldTarget === null) return;
    onNotesChange(
      setField(
        notes,
        new Set(setFieldTarget.notes.map((note) => note.note_id)),
        setFieldTarget.field,
        value,
      ),
    );
    setSetFieldTarget(null);
  };

  /** Right-click actions act on the row's edit targets, so a multi-row selection is one command. */
  const rowActions = (row: Note): readonly TableContextAction[] => {
    if (!isEditable) return [];
    const targets = editTargets(row.note_id);
    const targetNotes = notes.filter((note) => targets.has(note.note_id));
    const count = targetNotes.length;
    const noun = count === 1 ? "note" : `${String(count)} notes`;
    const allMuted = targetNotes.every((note) => note.mute);
    return [
      ...SETTABLE_FIELDS.map(
        (field): TableContextAction => ({
          id: `set-${field}`,
          group: "set",
          label: `Set ${FIELD_LABEL[field]} of ${noun}…`,
          onSelect: () => {
            setSetFieldTarget({ field, notes: targetNotes });
          },
        }),
      ),
      {
        id: "mute",
        group: "edit",
        label: allMuted ? `Activate ${noun}` : `Deactivate ${noun}`,
        onSelect: () => {
          setMute(targets, !allMuted);
        },
      },
      {
        id: "duplicate",
        group: "edit",
        label: `Duplicate ${noun}…`,
        onSelect: () => {
          setDuplicateSource(targetNotes);
        },
      },
      {
        id: "delete",
        group: "edit",
        label: `Delete ${noun}`,
        onSelect: () => {
          onNotesChange(notes.filter((note) => !targets.has(note.note_id)));
          setSelectedKeys(
            (keys) =>
              new Set([...keys].filter((key) => !targets.has(Number(key)))),
          );
        },
      },
    ];
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
      // Live: "To deactivate, or mute, a note (or notes), select it and press 0."
      keys: "0",
      onPress: toggleSelectedMute,
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
            <ToggleButton
              label="Details"
              size="sm"
              tooltip="Show mute, chance, velocity deviation and release velocity"
              icon={<Icon icon={SlidersHorizontal} color="inherit" />}
              isPressed={showDetails}
              onPressedChange={toggleDetails}
            />
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
        showDetails={showDetails}
        onCommitField={commitField}
        onToggleMute={toggleMute}
        rowActions={rowActions}
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
      {setFieldTarget !== null && (
        <SetNoteFieldDialog
          field={setFieldTarget.field}
          count={setFieldTarget.notes.length}
          initialValue={setFieldTarget.notes[0]?.[setFieldTarget.field] ?? 0}
          signatureNumerator={clip.signatureNumerator}
          signatureDenominator={clip.signatureDenominator}
          onClose={() => {
            setSetFieldTarget(null);
          }}
          onConfirm={confirmSetField}
        />
      )}
    </>
  );
}
