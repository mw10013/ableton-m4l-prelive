# Note List Editor Autowrite And A/B Slots Spec

Written September 2026. Supersedes the "Write to Live" button model in
`docs/note-list-editor-reliability-and-duplicate-research.md` decisions 2, 3, 4 and 5 where they
conflict with this document. Everything else there still holds.

## Decisions

1. **Autowrite is the only write mode.** Every change to the active note list is written to Live
   after a trailing debounce. The Write to Live button is removed. Reload from Live remains the one
   manual control.
2. **Writes are fire and forget.** The response of a write is never merged into the table and the
   editor is never remounted by a write. A failed write is overwritten by the next one. There is no
   synced, unverified, or generation state.
3. **Row identity is local.** The table row key is an integer minted in the browser from a counter
   scoped to the loaded clip. Live's `note_id` is read on load and dropped. The negative temp-id
   scheme is removed.
4. **Three named buffers.** `baseline` is read-only and captured on load. `a` and `b` are editable.
   Exactly one of `a` or `b` is `active`. The active slot is the working list: the table shows it,
   edits change it, autowrite sends it.
5. **Region changes autowrite too.** The playback region is auto-extended on every write exactly as
   the Write button did.
6. **On load, all three buffers hold the loaded clip.** Switching slots never silences the clip.
7. **Reload resets all three buffers** to the reloaded clip, after confirmation when any slot
   differs from `baseline`.
8. **Two slots, not N.** No snapshot list.
9. **Id-preserving edits through `clip_apply_note_modifications` are out of scope.** Whole-clip
   replace is the only write.
10. **The delete-then-add gap is a test, not a design input.** Test once with a dense sixteenth
    loop; design around it only if a note drops.

## Why

- **Loop-and-listen.** The user loops the clip in Live and edits in the table. Latency of a bar is
  acceptable; a button click per edit is not.
- **No undo.** The table has no undo stack. Named buffers turn "undo" into "return to a known
  point" and let two candidates be compared while the clip plays.
- **Independence from Live.** Under wholesale writes Live discards and reassigns every note id on
  every write, so Live's id is not a stable identity for anything the table holds. Borrowing it as a
  row key is what forced the negative-id trick. Local ids remove the coupling and the trick.
- **The plugin A/B idiom.** Two editable slots, one active, edits go into the active one, a switch
  changes what is heard, a copy pushes one over the other. Users already know this and it has no
  ambiguous state. An anonymous "stash" filled by Revert would have one: nobody knows when its
  contents become "the edits" again.

## Current code this changes

- `src/lib/LiveSet.ts` `replaceNotes`: reads the clip, builds one aliased mutation document
  (marker sets, `clip_remove_notes_extended`, `clip_add_new_notes`), decodes the last field as a
  full `ClipWithNotes` readback and returns `{ clip }`.
- `src/routes/index.tsx`: owns `notes`, `clipInfo`, `editorRevision`. `replaceMutation.onSuccess`
  calls `refreshClip`, which replaces `notes` with the readback and bumps `editorRevision`, the React
  key on `NoteListEditor` and `ScorePanel`. `onWrite` computes the region and calls the mutation.
- `src/components/NoteListEditor.tsx`: `EditorStatus` includes `writing` and `unverified`; renders
  Write to Live, the write error banner, `STATUS_LABEL`; `isEditable = isIdle && !isDialogOpen`.
- `src/lib/noteEdits.ts`: `nextTempId` allocates below the minimum id; `duplicateNotes` uses it;
  `toReplacementNotes` strips `note_id`.
- `src/lib/Domain.ts`: `Note` (wire type with `note_id`) is also the table row type.

## Part 1: Local row ids

Do this first. No user-visible behavior change.

### Types

Keep `Domain.Note` as the wire type Live returns. Introduce the editor row type in
`src/lib/noteEdits.ts`:

```ts
import type { ReplacementNote } from "@/lib/Domain";

export interface NoteRow extends ReplacementNote {
  readonly id: number;
}
```

`NoteListEditor`, `NoteTable`, `ScorePanel`, `DuplicateNotesDialog`, `SetNoteFieldDialog`, and
every helper in `noteEdits.ts` that currently takes `Note` takes `NoteRow` and keys on `id` instead
of `note_id`. `toReplacementNotes` strips `id`.

### Counter

The counter is part of the route's clip state and restarts at 1 whenever a clip is loaded or
reloaded. It is shared by all three buffers so a row copied from `a` to `b` keeps its id and no two
rows in the loaded clip ever share one.

```ts
export const rowsOf = (
  notes: readonly Note[],
  firstId: number,
): { readonly rows: readonly NoteRow[]; readonly nextId: number } => {
  const rows = byMusicalOrder(notes).map(
    ({ note_id: _noteId, ...fields }, index) => ({
      ...fields,
      id: firstId + index,
    }),
  );
  return { rows, nextId: firstId + rows.length };
};
```

Add and duplicate mint ids from the counter instead of `nextTempId`. Change signatures so the id
source is explicit:

```ts
export const duplicateNotes = ({
  notes, selected, destination, firstId,
}: { ...; readonly firstId: number }) => { notes, copies, nextId }
```

`NoteListEditor` receives `mintRowIds: (count: number) => readonly number[]` from the route (a
callback around the counter in the route reducer, see Part 3) and passes the first id into
`duplicateNotes` and the single-note add. Delete `nextTempId`.

### Load

`notesOf(clip)` in `src/routes/index.tsx` becomes `rowsOf(clip.get_all_notes_extended?.notes ?? [], 1)`.

## Part 2: Backend write

Server side stays Effect and stays one server function. Changes to `LiveSet.replaceNotes`:

1. **Drop the readback.** The last mutation field selects `{ id }` like the others. Delete the
   `Schema.decodeUnknownEffect(Domain.ClipWithNotes)` step. Return `{ clipId: input.clipId }`. The
   pre-write `readClipById` stays: it decides marker order and the deletion window.
2. **Instrument duration.** Wrap the mutation in `Effect.timed` and log it, so the debounce can be
   set from numbers:

   ```ts
   const [elapsed] = yield* gqlDecode(...).pipe(Effect.timed);
   yield* Effect.logInfo("replaceNotes").pipe(
     Effect.annotateLogs({ clipId: input.clipId, notes: input.notes.length, ms: Duration.toMillis(elapsed) }),
   );
   ```

3. Update the JSDoc on `replaceNotes`: phase 4 no longer reads back; failure policy is "the next
   write replaces the clip again." Keep the rest of the reasoning.
4. `Domain.ReplaceNotesInput` is unchanged. `serverFns.replaceNotes` is unchanged apart from its
   inferred return type.

Idioms: `Effect.fn` with a name, `Effect.gen`, typed `LiveQLError`, no `try`/`catch`, no mutable
state outside the `steps` accumulator that already exists.

## Part 3: Slots state

Owned by the route in one reducer so every transition is a pure function of the previous state.

```ts
type SlotName = "a" | "b";

interface ClipBuffers {
  readonly baseline: readonly NoteRow[];
  readonly a: readonly NoteRow[];
  readonly b: readonly NoteRow[];
  readonly active: SlotName;
  readonly nextId: number;
}

type BuffersAction =
  | { type: "load"; notes: readonly Note[] } // load, reload, clip switch
  | { type: "edit"; rows: readonly NoteRow[] } // any table change to the active slot
  | { type: "mint"; count: number } // advance nextId; ids are nextId..nextId+count-1
  | { type: "switch" } // active = other slot
  | { type: "copyToOther" } // other = active
  | { type: "revert" } // active = baseline
  | { type: "setBaseline" }; // baseline = active
```

Transitions:

- `load`: `{ rows, nextId } = rowsOf(notes, 1)`; `baseline = a = b = rows`; `active = "a"`.
- `edit`: replace `state[active]` with `rows`. Never touches the other slot or `baseline`.
- `mint`: `nextId += count`. Because reducers cannot return the minted ids to the caller, expose
  `mintRowIds` from the route as: read `state.nextId`, dispatch `mint`, return the range. React
  batches the dispatch and the following `edit` in the same event, and the range is derived from
  the state read before dispatch, so it is deterministic. If this proves awkward, replace with a
  `useRef` counter reset on `load`; either is acceptable.
- `switch`, `copyToOther`, `revert`, `setBaseline`: straight copies of array references. Arrays are
  immutable so no cloning is needed.

Derived: `activeRows = state[state.active]`, `otherSlot`, and

```ts
export const sameNotes = (x: readonly NoteRow[], y: readonly NoteRow[]) =>
  x.length === y.length && x.every((row, i) => sameFields(row, y[i])); // compares ReplacementNote fields, ignores id
```

Use `sameNotes` for every "differs" check below. Rows are kept in musical order by the existing
helpers so positional comparison is valid.

Reset on clip switch: dispatch `load` inside the existing `applyClip`.

## Part 4: Autowrite

A hook in `src/components/useAutowrite.ts`, used by the route:

```ts
export function useAutowrite({
  clipId,
  rows,
  region,
  write,
}: {
  clipId: number;
  rows: readonly NoteRow[];
  region: ClipRegion | undefined;
  write: (input: ReplaceNotesInput) => Promise<unknown>;
}): {
  status: "idle" | "pending" | "writing";
  lastError: string | null;
  flushNow: () => void;
};
```

Behavior:

- **Trailing debounce.** When `rows` or `region` changes by reference, clear any armed timer and arm
  a new one for `AUTOWRITE_DELAY_MS = 500`. On fire, call `flush()`.
- **Serialize.** At most one write in flight. `flush()` when a write is in flight sets a
  `dirty` flag and returns. When the in-flight write settles, if `dirty`, clear it and `flush()`
  again with the latest `rows`. So overlapping edits collapse into one follow-up write carrying the
  newest list.
- **Payload.** `{ clipId, notes: toReplacementNotes(rows), region }` where `region` is the result of
  the existing `requiredPlaybackRegion` / `isSameRegion` logic moved out of `onWrite` into a memo in
  the route.
- **flushNow.** Cancels the timer and calls `flush()` immediately. Used on slot switch.
- **Result handling.** On success: nothing. On error: set `lastError` to the message; a later
  success clears it. Never touch rows.
- **Status.** `pending` while a timer is armed, `writing` while a request is in flight, else `idle`.
- **Unmount or clipId change.** Clear the timer. Do not flush; a clip switch means the user left.
- **Initial load.** Do not write on the first render for a clip. Arm the debounce only for changes
  after load. Implement by storing the last-sent `rows` reference and treating the load rows as
  already sent.

Why no gesture hold: `useScrub` fires `onCommit` once on release and cell inputs commit on blur or
Enter, so `rows` only changes at gesture end. The debounce alone is enough.

Use `useMutation` from TanStack Query for the request so pending and error come for free, and a
`useRef` for the timer and `dirty` flag. Keep the hook free of Effect; it is browser glue.

Delete from the route: `replaceMutation`, `refreshClip`'s call from a write, `onWrite`,
`writeError`. `editorRevision` is now bumped only by `load` (clip load, reload) and `switch`.

## Part 5: Editor and UI

### NoteListEditor

- `EditorStatus` becomes `"idle" | "loading" | "reloading"`. Remove `writing` and `unverified`.
- Remove `onWrite`, `writeError`, the Write to Live button and its banner.
- `isEditable = isIdle && !isDialogOpen`. Editing continues while a write is in flight; that is the
  point.
- New props:

  ```ts
  autowrite: { status: "idle" | "pending" | "writing"; lastError: string | null };
  slots: { active: SlotName; activeDiffersFromBaseline: boolean; slotsDiffer: boolean };
  onSwitchSlot: () => void;
  onCopyToOther: () => void;
  onRevert: () => void;
  onSetBaseline: () => void;
  mintRowIds: (count: number) => readonly number[];
  ```

### Toolbar (existing note list `Toolbar`, `endContent`, left to right)

- `ToggleButton` pair labelled **A** and **B**; the pressed one is active. Pressing the other calls
  `onSwitchSlot`. Tooltip: "Switch to B — Live plays the active slot".
- Button **Copy to B** / **Copy to A** (label names the other slot). Calls `onCopyToOther`. Disabled
  when `!slotsDiffer`. Confirm with an Astryx `Dialog` (same pattern as `DuplicateNotesDialog`) when
  the other slot differs from `baseline`, since its contents are lost.
- Button **Revert to baseline**. Disabled when `!activeDiffersFromBaseline`. Confirm always when
  enabled; this discards edits.
- Button **Set baseline**. Disabled when `!activeDiffersFromBaseline`. No confirmation; nothing is
  lost that the slots do not still hold.
- Existing Details, Add note, Duplicate…, Delete, Reload from Live remain. Reload confirms when
  `a`, `b`, or the active slot differs from `baseline`.

### Status text (`startContent`)

After the note count: `Syncing…` when `autowrite.status !== "idle"`; nothing when idle. When
`lastError !== null`, `Last write failed — Live may be behind` in the secondary text style, no
banner. Keep `STATUS_LABEL` for `loading` and `reloading`.

### Route

- On `switch`: dispatch, bump `editorRevision`, then `flushNow()`. Order matters: the flush must see
  the new active rows, so compute the payload from the reducer's next state or flush in an effect
  keyed on `active`.
- `ScorePanel` receives `activeRows`.
- `Play Clip` remains.

## Part 6: Reload and clip switch

- `reloadMutation.onSuccess` dispatches `load` with the reloaded notes and bumps `editorRevision`.
  The confirmation (Part 5) happens before the mutation is fired.
- `applyClip` dispatches `load`. Nothing from the previous clip survives, including the counter.
- A clip that disappears (`clip === null`) behaves as today: `isClipMissing`, empty editor.

## Acceptance

1. Edit a cell, wait, hear the change in the looping clip. No click. Table selection and focus are
   unchanged after the write.
2. Scrub a value for two seconds. Exactly one write after release (check the server log).
3. Ten rapid arrow-key nudges produce one write, or two if the first started before the last nudge.
4. Kill the LiveQL server, edit, restart it, edit again. The second write brings Live current; the
   status text showed the failure and then cleared.
5. Load a clip. A, B and Baseline are identical. Copy to B is disabled, Revert is disabled.
6. Edit A. Switch to B. Live plays the original at once. Switch to A. Live plays the edit.
7. Copy A to B, switch to B, Revert. B is the baseline, A still has the edit, Live plays B.
8. Edit B. Switch to A. A is unchanged.
9. Set baseline on A. Revert is disabled. Switch to B, Revert: B now equals the new baseline.
10. Reload with a differing slot: confirmation appears; after confirming all three buffers equal the
    clip in Live.
11. Add and duplicate notes: ids are positive, unique, and increase; `note_id` no longer appears in
    `src/components` or `src/lib/noteEdits.ts`.
12. `pnpm typecheck` and `pnpm lint` pass.

## Order of work

1. Local row ids (Part 1).
2. Backend: drop readback, add timing (Part 2). Measure with the existing button before removing it.
3. Buffers reducer with a single slot exercised (Part 3, `load` and `edit` only).
4. Autowrite hook, remove Write button and write-driven remount (Parts 4, 5 minus slot controls).
5. Slot controls, Revert, Set baseline, Reload confirmation (Parts 5, 6).
6. Dense-sixteenth gap test (decision 10).

## Not in scope

- Any use of Live's `note_id` after load.
- `clip_apply_note_modifications` or any partial write.
- Merging or verifying readbacks.
- More than two editable slots, named snapshots, undo/redo.
- Gesture hold on the debounce.
- Detecting or preserving edits made in Live's piano roll while autowrite is active. They are
  overwritten on the next table edit; the table is the sole editor for a loaded clip.
