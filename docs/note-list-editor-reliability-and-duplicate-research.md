# Note List Editor Hard Sync And Duplicate Plan

Updated September 2026 after the LiveQL schema pass, Live verification, DAW manual comparison, and
product review.

## Decisions

1. Prelive owns one complete editable note list for the selected MIDI clip.
2. **Write to Live** destructively replaces every note in Live with that complete list.
3. Replacement is delete-all, add-all, readback. It is intentionally not transactional.
4. Prelive does not retain a baseline, calculate diffs, reconcile note IDs, merge concurrent edits,
   or automatically retry failed writes.
5. **Reload from Live** replaces the local list and is the only recovery action after an uncertain
   write.
6. Local undo/redo is out of scope.
7. **Duplicate...** opens a destination dialog modeled after Logic's Event List.
8. Duplicate transforms Session and Arrangement clip notes identically.
9. **Write to Live** auto-extends the clip's playback region to cover every note. It never shrinks
   it, and no edit ever produces an out-of-range warning.
10. MPE and other unmodeled per-note expression are unsupported and may be removed by replacement.

## One-List Editor Model

### Authoritative local state

The route owns one controlled array:

```ts
const [notes, setNotes] = useState<readonly Note[]>([]);
```

Every add, edit, delete, and Duplicate returns the complete next array. `NoteListEditor` receives the
array and update callback. `ScorePanel` receives the same array as source input. Its rendered score
may remain a derived cache because LilyPond rendering is asynchronous; it is not another editable
note state.

Remove the current editor's `baseline`, nullable `draft`, `modifiedNoteIds`, `deletedNoteIds`, and
`markModified` state (`src/components/NoteListEditor.tsx:66-99`). Remove route/editor synchronization
through `onStateChange` (`src/components/NoteListEditor.tsx:78-82`, `src/routes/index.tsx:137-141`).

The editor still owns non-musical UI state:

- selected row keys
- multi-edit mode
- Duplicate dialog state
- write status

Fetched notes retain positive Live `note_id` values as row keys. Locally added or duplicated notes
receive negative temporary row keys. IDs are UI identity only. Every replacement payload strips every
`note_id`, positive or negative.

Allocate temporary IDs from the current list rather than a module-global counter:

```ts
const firstTempId = Math.min(0, ...notes.map(({ note_id }) => note_id)) - 1;
```

Allocate successive copies downward from `firstTempId`.

### Loading and replacing state

These actions replace the one local list and clear selection:

| Action                    | Result                                                          |
| ------------------------- | --------------------------------------------------------------- |
| Initial clip read         | Display returned notes                                          |
| Select another clip       | Discard current local list and display the new clip             |
| Reload from Live          | Discard current local list and display exact clip-by-ID result  |
| Successful Write          | Display notes returned by replacement readback                  |
| Failed Write              | Keep current list visible but lock it until Reload from Live    |
| Reload after failed Write | Display actual Live state, including an empty or partial result |

Do not prompt on clip switch or Reload in the first version. Those actions are explicitly
destructive. Do not retain a dirty snapshot for possible restoration.

Write and Reload are always available while idle, including when the note list is empty. An empty
replacement deliberately clears the Live clip. While writing, reloading, or loading another clip,
disable all note editing, selection operations, Duplicate, and navigation that could apply a stale
result to another clip.

Only explicit initial load, clip selection, Reload, or Write completion may replace the working
array. Background query-cache updates must not silently overwrite local edits.

### Clip eligibility

Only MIDI clips have a note editor. An audio clip has `get_all_notes_extended: null`; it must not be
treated as an empty MIDI clip. Hide or disable `NoteListEditor` for `is_midi_clip === false`.

If exact clip-by-ID Reload returns `null`, close the editor and report that the clip no longer exists.

## LiveQL Hard Replacement

### GraphQL contract

Add this synthetic mutation in the standalone LiveQL repository, then update Prelive's LiveQL ref and
deployed device:

```graphql
input ReplacementNoteInput {
  pitch: Int!
  start_time: Float!
  duration: Float!
  velocity: Float!
  mute: Boolean!
  probability: Float!
  velocity_deviation: Float!
  release_velocity: Float!
}

type Mutation {
  clip_replace_notes(id: Int!, notes: [ReplacementNoteInput!]!): Clip
}
```

`ReplacementNoteInput` deliberately has no `note_id` and no optional musical fields. The resolver
must reject a non-MIDI clip before changing it.

The caller selects the complete clip and note fields from the mutation result. That result is the
successful readback; do not issue a second success query.

### Delete-all range

`remove_notes_extended` needs a finite pitch/time window. Derive that window from one complete note
snapshot immediately before deletion. This remains wholesale deletion; IDs are not used.

For a non-empty snapshot:

```ts
const fromTime = Math.min(...existingNotes.map(({ start_time }) => start_time));
const throughTime =
  Math.max(...existingNotes.map(({ start_time }) => start_time)) + 1;

remove_notes_extended(0, 128, fromTime, throughTime - fromTime);
```

The operation selects notes by onset. Adding one beat above the greatest onset places every observed
note strictly inside the half-open time window. `from_pitch: 0` and `pitch_span: 128` include MIDI
pitches 0 through 127. Negative starts, notes beyond markers, and pitch 127 are covered without an
infinite or arbitrary global time constant.

If the snapshot is empty, skip `remove_notes_extended`. Simultaneous editing in Live is unsupported;
a note inserted after the snapshot may survive.

### Resolver phases

Execute exactly these phases:

1. `preflight`: resolve the ID and reject non-MIDI clips.
2. `snapshot`: read all existing extended notes.
3. `remove_notes_extended`: delete the complete snapshot range when non-empty.
4. `add_new_notes`: add the submitted complete list when non-empty; ignore returned IDs.
5. `readback`: return the refreshed clip.

Wrap each phase error using the existing `clip_write_notes` style:

```text
liveql: clip_replace_notes step <phase> failed: <message>
```

Known consequences are accepted:

- Delete succeeds and Add fails: Live may be empty or partially rewritten.
- The response is lost after Add succeeds: the outcome is unknown.
- A simultaneous Live edit may survive or alter the result.
- A playing clip may be silent or incomplete while replacement is running.
- Every successful replacement assigns fresh Live IDs.

Do not add rollback, selective cleanup, operation IDs, per-clip serialization, semantic comparison,
or automatic retry in this pass.

### Prelive write behavior

Capture the current complete list in the request body, strip all IDs, and call
`clip_replace_notes`. Disable the entire editor before submission.

On a successful GraphQL response:

1. Replace the local list with returned notes.
2. Clear selection and temporary IDs through that replacement.
3. Return to editable state.

On any GraphQL, transport, decode, or timeout failure:

1. Show that Live may now contain an empty or partial replacement.
2. Keep the current list visible for context but disable editing and Write.
3. Offer **Reload from Live** only.
4. Do not automatically query or retry because a timed-out resolver may still be running.

Reload performs an exact nullable `clip(id)` query. Its success replaces the local list and unlocks
the editor. Its failure leaves the editor locked.

Use a replacement-specific timeout longer than the current ten-second default or leave timeout
selection as an implementation constant. A timeout always enters the same uncertain state; it never
triggers automatic recovery.

### Unsupported MPE

Delete-and-recreate can remove per-note expression attached to old note identities. Prelive does not
currently read, display, or write MPE. Document replacement as destructive and do not add MPE
preservation or detection until MPE becomes an explicit product feature.

## Duplicate Research

### Live

Live's manual says note editing is selection-based but does not define Duplicate placement
(`refs/live-manual/en/live-manual/12/editing-midi/index.md:111-113`). LiveQL's real-Live verification
found that native `duplicate_notes_by_id` shifts copies by the exact occupied selection span:

```ts
Math.max(...selected.map((note) => note.start_time + note.duration)) -
  Math.min(...selected.map((note) => note.start_time));
```

The result is not grid-snapped (`docs/liveql-schema-pass-handoff.md:329-344`). A sixteenth duplicates
one sixteenth later. Prelive deliberately does not use this placement.

Live's Duplicate Time instead repeats an explicitly selected timespan, including contained notes
(`refs/live-manual/en/live-manual/12/editing-midi/index.md:535-542`).

### Logic

Logic's Event List asks for the first copied event's destination and preserves every other copied
event's relative position:

> Enter a destination position for the first event ... The relative positions of other copied events
> are maintained.

Source:
`refs/logic-manual/guide/logicpro/create-events-in-the-event-list-lgcp2158295a/12.3_/mac/15.md:26-37`.

Logic's Piano Roll separately applies Snap to copying and supports absolute and relative positioning
(`refs/logic-manual/guide/logicpro/snap-items-to-the-grid-lgcpa9051d7a/12.3_/mac/15.md:7-27`). Its
advanced Copy operation adds count and collision modes; those are not needed initially.

### Cubase

Cubase separates Duplicate and Repeat. Duplicate creates one copy behind the source while preserving
relative distances. Alt/Option-drag uses an explicit snapped destination. Repeat asks for a count
(`refs/cubase-manual/operation-manual/midi-editors.md:389-411`).

### Digital Performer

Digital Performer Repeat requires a time-range selection, repeats the entire range including rests,
and recommends whole measures for aligned repetition
(`refs/performer-manual/SIRA/Digital_Performer_Help/pages/edit_menu.md:73-77`). It does not document a
selected-event Duplicate equivalent.

These products distinguish selected-event copying from time-range repetition. Prelive should begin
with Logic's explicit destination model and add Repeat only if it later gains time-range selection.

## Duplicate Specification

### Command and dialog

- Toolbar label: **Duplicate...**.
- Shortcut: Cmd/Ctrl-D.
- Disabled with no selection or while the editor is not idle.
- Cmd/Ctrl-D opens one Astryx form Dialog and does nothing if it is already open.
- Opening snapshots the selected notes and clip ID.
- Dialog title: **Duplicate notes**.
- Fields: one **Destination** `NumberInput`.
- Footer actions: **Cancel** and **Duplicate**.
- Escape and Cancel close without changing notes, selection, or clip state.
- Enter confirms only when the current Destination is valid.
- All table and playback hotkeys are disabled while the dialog is open.

### Destination

Destination is the new `start_time` of the earliest selected note. It uses Live's raw quarter-note
units:

- `0` is clip time zero.
- `1` is one quarter note.
- Input step is `0.25`.
- Minimum is `0`.
- The input displays a supporting read-only `bar.beat.sixteenth` label using the existing clip time
  signature and `positionLabel`.
- Empty, non-finite, or negative values cannot confirm.

Default to the first quarter-note boundary at or after the latest selected note end. Use
`TIME_EPSILON = 1e-9` so floating error does not skip an exact boundary:

```ts
const selectionEnd = Math.max(
  ...selected.map(({ start_time, duration }) => start_time + duration),
);
const destination = Math.ceil(selectionEnd - TIME_EPSILON);
```

Confirmation uses one uniform offset:

```ts
const selectionStart = Math.min(
  ...selected.map(({ start_time }) => start_time),
);
const offset = destination - selectionStart;
```

Each copied start is `source.start_time + offset`. Do not round copied starts or internal offsets.

### Copy result

- Copy pitch, start offset, duration, velocity, mute, probability, velocity deviation, and release
  velocity.
- Assign fresh negative temporary row IDs below every current ID.
- Add exactly one copy of every snapshotted source note.
- Preserve gaps, chords, overlaps, and identical notes.
- Existing notes at the destination remain unchanged.
- Destination equal to the source start intentionally creates overlapping copies.
- Sort by start time, then pitch; tied row order has no musical meaning.
- Close the dialog and select only the copies.

### Playback boundaries

Duplicate applies the same transformation to Session and Arrangement clips.

Copies that land outside the clip's playback region are never warned about. Write extends the region
instead, so anything the editor holds can be heard. The region is `[loop_start, loop_end]` when
looping and `[start_marker, end_marker]` when unlooped; Write grows the matching pair, rounded out to
the bar from the clip time signature, and never shrinks it. A destination earlier than the current
region start pulls the start back the same way.

Extension is a property of Write, not of Duplicate: it is computed from the complete note list, so an
added or dragged note extends the clip exactly as a copy does. The dialog states the consequence
plainly rather than warning about it — `clip extends to N bars on write`.

This removes clip kind from the first Duplicate implementation.

## Acceptance Matrix

### LiveQL replacement

- Empty clip to empty list.
- Non-empty clip to empty list.
- Empty clip to non-empty list.
- Non-empty clip to different non-empty list.
- Pitch 0 and 127 are deleted and recreated.
- Negative-time existing notes and notes beyond markers are included in the derived deletion window.
- All eight modeled fields round-trip.
- Snapshot failure causes no mutation.
- Delete failure prevents Add.
- Add failure after Delete leaves the destructive result and reports the `add_new_notes` phase.
- Readback failure reports the `readback` phase.
- Audio clip rejection causes no mutation.
- Returned addition IDs are ignored.

### Prelive replacement

- Every payload strips positive and negative IDs.
- Empty working list can be written.
- All editing and navigation lock during Write.
- Success replaces the list with returned notes and clears selection.
- Every failure exposes Reload only and never automatically queries or retries.
- Reload uses exact clip ID and accepts an empty MIDI note list.
- Reload failure remains locked.
- Missing clip closes the editor.
- Audio clip never renders the note editor.
- Late query or write results cannot replace a different selected clip.

### Duplicate

- One note ending exactly on a quarter boundary defaults to that boundary.
- Values within `TIME_EPSILON` above a boundary do not jump to the following quarter.
- An off-grid source keeps every relative offset after explicit destination placement.
- Chords with mixed durations use the latest selected end for the default.
- Gapped selections preserve their gaps.
- Destination before, equal to, or after the source is accepted when all copied starts stay
  non-negative.
- Exact and partial overlaps preserve originals.
- Every non-ID note field is preserved.
- Temporary IDs are unique and only copies are selected.
- Cancel and Escape make no changes.
- Invalid Destination cannot confirm.
- Cmd/Ctrl-D and table/playback shortcuts do not fire behind an open dialog.
- Session and Arrangement notes use the same copy transform.
- Copies past the region end never warn; Write extends the region to the bar and never shrinks it.
- A destination before the region start pulls the region start back.

## Delivery Plan

### Slice 1: LiveQL

- Implement strict `ReplacementNoteInput` and `clip_replace_notes` in the standalone LiveQL repo.
- Implement snapshot-derived full-range deletion and phase errors.
- Add fake-LOM coverage for `remove_notes_extended`.
- Add the LiveQL acceptance cases above.
- Run `pnpm test`, `pnpm test:n4m`, and the destructive `pnpm test:live` matrix.
- Publish/update the device, then refresh Prelive's LiveQL ref.

### Slice 2: Prelive one-list editor

- Add exact nullable `readClipById` and replacement server functions.
- Lift the complete note list to route state.
- Remove draft, baseline, modified/deleted sets, and note diff construction.
- Replace Discard with Reload from Live.
- Add idle/writing/unverified status and disable all relevant controls.
- Prevent stale query results and clip switches from replacing the wrong list.
- Send complete replacement notes with every ID stripped, plus the extended region when it grew.

### Slice 3: Duplicate

- Discover Astryx Dialog and input APIs through the project CLI.
- Extract pure default-destination and copy operations.
- Implement dialog, validation, extension readout, and keyboard behavior.
- Apply one complete list update and select copied rows.

### Deferred

- Local undo/redo.
- Diff or ID-preserving writes.
- Automatic write retry or rollback.
- MPE preservation.
- Semantic post-write comparison.
- Concurrent Live editing support.
- Duplicate count, spacing, transposition, and collision modes.
- Time-range Repeat.
- Shrinking a playback region that edits no longer fill.

Prelive currently has no application test runner (`package.json:6-20`). Do not add one solely for
this work. Keep destination and copy operations pure, exercise the manual acceptance matrix, and run
`pnpm typecheck`, `pnpm lint`, and `pnpm fmt:check` for each Prelive slice.

## Sources

- Current editor: `src/components/NoteListEditor.tsx`, `src/components/NoteTable.tsx`
- Current route state: `src/routes/index.tsx`
- Current domain and write path: `src/lib/Domain.ts`, `src/lib/LiveSet.ts`, `src/lib/serverFns.ts`
- LiveQL schema and resolvers: `refs/liveql/liveql-n4m.js`
- LiveQL verification results: `docs/liveql-schema-pass-handoff.md`
- Existing roadmap: `docs/note-list-editor-development-research.md`
- Live MIDI editing: `refs/live-manual/en/live-manual/12/editing-midi/index.md`
- Logic Event List: `refs/logic-manual/guide/logicpro/create-events-in-the-event-list-lgcp2158295a/12.3_/mac/15.md`
- Cubase MIDI editors: `refs/cubase-manual/operation-manual/midi-editors.md`
- Digital Performer editing: `refs/performer-manual/SIRA/Digital_Performer_Help/pages/edit_menu.md`
