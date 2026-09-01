# Note List Editor Reliability And Duplicate Research

Research question: does Prelive need draft undo/redo and reliable write reconciliation before adding
Duplicate, what is the smallest justified implementation, and how should Duplicate behave if Live is
the primary interaction model?

## Recommendation

Do not treat "undo/redo plus reconciliation" as one indivisible project.

1. Implement reliable write reconciliation first. This fixes a correctness problem in the current
   editor regardless of which feature comes next.
2. Characterize Live's native selected-note Duplicate behavior with a small disposable clip before
   fixing Prelive's placement formula.
3. Implement one-copy, Live-style Duplicate in the local draft. Copies become the selection, so
   Delete and Discard provide understandable recovery even before undo exists.
4. Add bounded local draft undo/redo before bulk destructive transformations, repeat counts, or drag
   scrubbing. Those interactions are substantially harder to reverse manually than one duplicate.

Reliable reconciliation is required before Duplicate. Full undo/redo is valuable and eventually
necessary, but it is not a hard prerequisite for the first additive Duplicate command. Splitting the
work this way lowers implementation risk without accepting the current write ambiguity.

This refines the combined Phase 0 proposed in `docs/note-list-editor-development-research.md`. If
approved, that roadmap should be updated so it no longer implies that history and reconciliation must
ship together.

## Why Reconciliation Is Required Now

### Current implementation evidence

`NoteListEditor` captures the baseline only on mount and maintains a nullable draft plus cumulative
modified/deleted sets (`src/components/NoteListEditor.tsx:65-77`):

```ts
const [baseline] = useState<readonly Note[]>(initialNotes);
const [draft, setDraft] = useState<Note[] | null>(null);
const [modifiedNoteIds, setModifiedNoteIds] = useState<Set<number>>(new Set());
const [deletedNoteIds, setDeletedNoteIds] = useState<Set<number>>(new Set());
const notes = draft ?? baseline;
const hasDraft = draft !== null;
```

Newness is inferred from negative IDs when Write constructs its payload; only persisted positive IDs
enter the modified and removed sets (`NoteListEditor.tsx:91-95,171-184`). These sets are conservative,
not exact diffs: returning a value to its baseline does not remove the ID from `modifiedNoteIds`.

`LiveSet.writeNotes` then executes three independently committed phases in this order
(`src/lib/LiveSet.ts:177-208`):

1. `clip_add_new_notes`
2. `clip_apply_note_modifications`
3. `clip_remove_notes_by_id`

Effect correctly short-circuits after a failure, but it cannot roll back an earlier LOM call.

The current success callback does not await reconciliation (`NoteListEditor.tsx:84-89`):

```ts
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: ["clip"] });
};
```

The route normally applies changed refetched data and increments `editorRevision`; that revision is
the `NoteListEditor` and `ScorePanel` React key, so remounting clears local state
(`src/routes/index.tsx:150-184,436-460`). This indirect reset has three gaps:

- A failed refetch leaves the old temporary IDs and draft mounted after the mutation reported success.
- TanStack Query structural sharing can retain data identity when the server result is unchanged; the
  route effect listens to `clipQuery.data`, so a no-op write need not cause a reset.
- No error callback refetches after a partially successful sequence.

The Write button displays `writeMutation.isPending` as loading but only explicitly disables itself
when `!hasDraft` (`NoteListEditor.tsx:243-256`). Whether loading blocks a second press is delegated to
Astryx rather than enforced by the editor's write-state model. The error banner only renders the
rejected message and does not distinguish a zero-effect failure from a partial write
(`NoteListEditor.tsx:269-279`).

### The editor and Live have different identities

Persisted Live notes have positive `note_id` values assigned by Live. New draft notes use negative
temporary IDs so rows and selections remain stable before a write. Live's `add_new_notes` function
assigns the real IDs when notes are persisted:

> Returns a list of note IDs of the added notes.

Source: [Live Object Model Clip reference](https://docs.cycling74.com/apiref/lom/clip/#add_new_notes).

The local draft therefore cannot remain authoritative after a successful write. It still contains
temporary identities that no longer exist in Live. The editor must read the clip back and replace its
baseline and draft with Live's returned state.

Invalidating a query is not, by itself, reconciliation. TanStack Query documents that
`invalidateQueries` marks matching data stale and refetches active queries in the background. The
local editor also has to consume the new query result and discard its pre-write bookkeeping. TanStack
Query recommends awaiting invalidation from `onSuccess` so the mutation stays pending until the data
is updated:

> Returning a Promise on `onSuccess` makes sure the data is updated before the mutation is entirely
> complete.

Source: `refs/tan-query/docs/framework/react/guides/invalidations-from-mutations.md:18-45`.

### A write is multiple non-atomic operations

The current LiveQL schema exposes separate mutations for adding, modifying, and removing notes.
Prelive's write path conditionally performs those operations in sequence. There is no transaction or
rollback in the Live Object Model.

Representative failure:

1. Adding new notes succeeds.
2. Modifying existing notes fails because LiveQL disconnects or an ID has become stale.
3. Removing notes is never attempted.
4. Live now contains only the successful first portion.
5. The browser still holds the original temporary additions and the remaining intended changes.
6. Blindly retrying the same payload can add the successful notes a second time.

This is not theoretical transactional perfectionism. Duplicate creates new notes, which means it
exercises the first phase on nearly every write and makes accidental re-addition more likely.

### Success also requires verification

A successful GraphQL response proves that the requested LOM calls returned; it does not prove that
the browser's old draft now represents Live. A post-write read is needed to acquire:

- Real note IDs for additions.
- Live-normalized field values.
- The actual set of notes after additions, modifications, and removals.
- The effective playback boundary after a boundary change.

The editor-facing `Domain.ClipWithNotes` and its queries currently expose `length` but omit
`loop_start`, `loop_end`, `start_marker`, and `end_marker`
(`src/lib/Domain.ts:72-81`, `src/lib/LiveSet.ts:19-23,91-100`). LiveQL also lacks those marker fields
and mutations. Boundary reconciliation therefore requires extending that schema; comparing note tails
with `length` alone cannot distinguish looped, unlooped, and Arrangement playback behavior.

After successful verification, the editor can safely clear temporary IDs, dirty tracking, history,
and selection. Without that reset, a second press of Write can replay already-completed intent.

### Failure must not look like an ordinary retry

After any write error, Prelive does not know that nothing changed. The safe behavior is:

1. Stop the write sequence.
2. Mark the result as potentially partial.
3. Refetch the clip before enabling Write again.
4. Rebase the editor on the server result.
5. Explain that some requested changes may have reached Live.

If reconciliation itself fails, keep the editor in an explicit "verification required" state. Do not
offer a generic retry that resubmits the same write payload. Reload/reconnect and read first.

## What Reliable Reconciliation Means

### Minimal state model

The editor needs to distinguish these concepts:

| State       | Meaning                                                   | Editing | Write |
| ----------- | --------------------------------------------------------- | ------- | ----- |
| Clean       | Draft equals the last verified Live snapshot              | Yes     | No    |
| Dirty       | Draft differs from the verified snapshot                  | Yes     | Yes   |
| Writing     | A frozen payload is being sent through sequential calls   | No      | No    |
| Verifying   | Calls succeeded; Prelive is reading authoritative data    | No      | No    |
| Reconciling | A call failed; Prelive is reading possibly partial data   | No      | No    |
| Unverified  | The write outcome cannot currently be read back from Live | No      | No    |

Freezing editing while writing is the smallest safe concurrency rule. Otherwise an edit made after
the payload is captured could be erased when success resets the draft, or incorrectly presented as
having been included in the write. A later design could version concurrent edits, but that complexity
has no current product need.

### Success path

1. Capture one immutable payload from the current verified baseline and draft.
2. Disable editing, operations, Discard, and repeated Write.
3. Execute the required LiveQL calls in a documented order.
4. Await an exact clip refetch rather than merely scheduling background invalidation.
5. Replace the baseline with the fetched notes and clip boundaries; clear the draft.
6. Clear temporary IDs, change tracking, selection, and local history.
7. Return to Clean.

TanStack Query's `refetchQueries` returns a promise and can use `throwOnError: true`; its default is
not to throw when a refetch fails (`refs/tan-query/docs/reference/QueryClient.md:253-296`). Explicit
verification should opt into failure rather than silently treating a failed read as success.

### Error path

1. Preserve the error and identify the failed phase if possible.
2. Do not automatically run later phases.
3. Refetch with errors surfaced.
4. If refetch succeeds, reset to the actual Live state and report a partial-write warning.
5. If refetch fails, enter Unverified and require a successful read before editing or retrying.

Automatically reapplying the unsaved remainder after a partial failure is deliberately out of scope.
Mapping temporary additions to newly assigned Live IDs is ambiguous, and guessing risks duplicate
notes. The safe first version prefers a verified state over preserving every uncommitted intention.

### Boundary-changing writes

Duplicate may require extending the clip's playback boundary. This adds another non-atomic call. If a
write must extend the boundary, perform that extension before adding notes:

- Boundary succeeds, notes fail: the clip may be longer than needed, but no notes are hidden.
- Notes succeed, boundary fails: new notes exist outside playback and may appear to have disappeared.

The first failure is easier to see and recover from, so boundary-first is the safer order. The final
refetch remains authoritative in either case.

### Explicit non-goals

The first reconciliation change should not add:

- Distributed transactions or rollback emulation.
- Automatic replay of unfinished phases.
- Offline mutation persistence.
- Concurrent editing during a write.
- Cross-editor conflict resolution for someone editing the same notes in Live simultaneously.
- Calling Live's global `Song.undo` from Prelive.

`Song.undo` affects the entire Live Set, including actions outside Prelive. It is not a safe substitute
for local draft history and could undo an unrelated user action.

### Expected complexity

| Work                                         | Complexity  | Reason                                                      |
| -------------------------------------------- | ----------- | ----------------------------------------------------------- |
| Await successful refetch and force reset     | Low         | Existing query and `editorRevision` remount path can remain |
| Lock editing while write outcome is unknown  | Low-medium  | Pending state must reach toolbar and editable cells         |
| Reconcile after a write error                | Medium      | Must represent partial and unverified outcomes distinctly   |
| Add playback-boundary reconciliation         | Medium      | Requires new LiveQL fields and mutation                     |
| Add local snapshot undo/redo to current sets | Medium-high | Several independently tracked structures must stay aligned  |
| Derive diffs from baseline before history    | Medium      | Simplifies history but changes existing payload bookkeeping |

The immediate reconciliation slice should not include the final two rows. It can preserve the current
draft and change-set representation, use an explicit awaited route-level refetch, and invoke the
existing `editorRevision` remount path unconditionally with the fetched result. This handles
unchanged-data structural sharing without introducing a reducer or generalized state machine
framework. The states above describe observable behavior; they do not require six React state
variables or a new library.

## Is Local Undo/Redo Necessary?

### The case for it

Live describes MIDI editing as non-destructive because the user can always return a clip to its
previous state with Undo (`refs/live-manual/en/live-manual/12/editing-midi/index.md:111-117`). A local
draft editor intercepts changes before they reach Live, so Live's own history cannot undo those draft
changes.

Discard is not equivalent to Undo:

- Discard removes every draft change, not only the last action.
- A user cannot undo an accidental transform while preserving earlier careful edits.
- Redo is useful when comparing a musical transformation by sight in the score.
- Multi-note operations and drag gestures can change many values from one input.
- Once Repeat, quantize, velocity ramps, legato, or humanization exist, manually reconstructing the
  previous draft is unreasonable.

Undo also imposes a useful operation boundary: one user intent should produce one reversible state
transition. Duplicate, deleting a selection, a scrub gesture, and a quantize command each become one
history entry rather than one entry per affected note or pointer movement.

### Why it can be deferred past the first Duplicate

The initial Duplicate operation is additive and can select only its new copies. Pressing Delete then
reverses the visible result; Discard remains the full reset. That is weaker than Undo, but it is a
reasonable temporary recovery path for one command.

Bundling history into reconciliation also forces an avoidable state refactor before the write bug is
fixed. The current editor tracks note arrays and categories of changes separately. Reliable history
must restore those structures consistently, or simplify them first. Reconciliation can be corrected
without deciding that larger architecture.

Therefore:

- Reconciliation is a correctness prerequisite for Duplicate.
- Undo/redo is a usability prerequisite for broader destructive and continuous operations.
- It is acceptable to ship one-copy Duplicate between those milestones if copies remain selected and
  Delete behavior is clear.

### Smallest sensible history design

When history is added, prefer a verified `baseline` plus snapshots of the complete draft note array:

```ts
interface DraftHistory {
  readonly past: readonly (readonly Note[])[];
  readonly present: readonly Note[];
  readonly future: readonly (readonly Note[])[];
}
```

Derive additions, modifications, and removals by comparing `present` with `baseline` at write time:

- Negative ID in present: addition.
- Positive ID present but unequal to baseline: modification.
- Positive baseline ID absent from present: removal.

This avoids storing history for several change sets that can contradict one another. Selection does
not need to be part of ordinary history; each operation can explicitly choose its resulting
selection. Clear history after successful reconciliation because the old temporary and persisted IDs
no longer describe the new baseline.

Bound history to a practical number of commands rather than retaining every pointer update. A scrub
gesture previews continuously but commits one snapshot on pointer release.

## Duplicate: What Live Establishes

Live's general model is selection first, command second:

> You select something using the mouse or computer keyboard, then execute a command (e.g., Cut, Copy,
> Paste, Duplicate) on the selection.

Source: `refs/live-manual/en/live-manual/12/editing-midi/index.md:111-113`.

The user manual names Duplicate but does not specify the destination formula. The LOM is more useful:

> The selection of notes will be duplicated to `destination_time`, if provided. Otherwise the new
> notes will be inserted after the last selected note. This behavior can be observed when duplicating
> notes in the Live GUI.

Source: [Live Object Model Clip reference](https://docs.cycling74.com/apiref/lom/clip/#duplicate_notes_by_id).

That establishes:

- Duplicate acts on selected note IDs.
- It preserves the selected notes as a unit.
- A destination can be explicit.
- Omitting the destination invokes Live's native "after the last selected note" behavior.

It does not establish the exact offset arithmetic or whether a GUI duplicate changes playback
markers. Live separately documents Duplicate Time and Duplicate Loop. Duplicate Time does not change
clip start/end or loop settings (`editing-midi/index.md:535-542`); Duplicate Loop explicitly doubles
the loop and its contents (`editing-midi/index.md:544-554`). Automatic playback-boundary extension is
therefore a deliberate Prelive enhancement, not something the manual proves ordinary note Duplicate
does.

## Proposed Duplicate Experience

### First version: one Live-style command

- Toolbar action: **Duplicate**.
- Shortcut: Cmd/Ctrl-D when focus is in the table but not in an active text/number input.
- Enabled only when at least one note is selected and no write is pending.
- Creates one copy of every selected draft note, including unsaved new or modified notes.
- Preserves pitch, duration, velocity, mute, probability, velocity deviation, release velocity, and
  every relative start offset.
- Assigns fresh negative temporary IDs.
- Selects only the copies after insertion.
- Resorts by musical time while preserving selected IDs.
- Does not wrap notes at the loop boundary or replace notes already at the destination.
- Repeated Cmd/Ctrl-D duplicates the newly selected copies, matching the fast repeated-command feel
  of Live.

Do not expose count, spacing, destination, or transposition in the first command. Those belong in a
later **Duplicate...** or **Repeat...** operation. The unmodified Duplicate action should remain fast
and predictable.

### Placement must be characterized, not guessed

Before implementation, compare Live GUI Cmd/Ctrl-D and LOM `duplicate_notes_by_id` without
`destination_time` using a disposable MIDI clip. Record starts and durations before and after these
cases:

1. One grid-aligned sixteenth note.
2. One off-grid note.
3. A chord with mixed durations.
4. Two notes with a gap between them.
5. A selection whose last onset has a short duration.
6. Overlapping notes.
7. Notes ending exactly at and beyond the loop end.
8. The same selections under several grid settings.

This will answer whether Live uses occupied duration, onset span, grid-rounded span, or another rule,
and whether the current grid affects Cmd/Ctrl-D. Prelive should copy the observed rule for the fast
Duplicate command unless it produces behavior inappropriate for a list editor.

If exact parity cannot be established, the fallback should be explicit rather than hidden:

`offset = ceil(occupied selection span / duplicate grid) * duplicate grid`

That preserves internal timing while placing the next copy on a musical unit. It is the proposed
Prelive fallback, not a claim about Live.

### Playback-boundary extension

The user's requested behavior is to allow out-of-range copies and extend playback so they can be
heard. Represent that extension in the draft before Write:

- Calculate the furthest end among notes created or moved by the draft.
- If it exceeds the effective playback end, show the pending old and new boundary.
- For a looped Session clip, extend `loop_end`.
- For an unlooped Session clip, extend `end_marker` or the proven equivalent from the LOM test.
- Never shorten the current boundary automatically.
- Do not silently wrap notes.
- Keep Arrangement clips out of the first version until resizing their Arrangement region is proven.

The exact rounding policy remains a product decision:

| Policy             | Benefit                                    | Cost                                        |
| ------------------ | ------------------------------------------ | ------------------------------------------- |
| Exact required end | Minimal and never invents extra empty time | Often creates awkward fractional lengths    |
| Duplicate grid     | Consistent with repetition spacing         | Grid may still be smaller than a useful bar |
| Next full clip bar | Produces conventional musical loop lengths | Adds potentially unwanted empty time        |

Recommendation: default to the next full clip bar, calculated from the clip time signature, and show
the pending extension before Write. The placement offset and clip-boundary rounding are separate
rules; changing one must not silently change the other.

### Why not call Live's duplicate function immediately?

`duplicate_notes_by_id` only accepts IDs already present in Live. It cannot duplicate unsaved new
notes, and immediately invoking it would bypass Prelive's local draft, Discard behavior, score
preview, and eventual local undo. Using it for some selections and local copying for others would
create inconsistent behavior.

The native function remains useful as the behavioral oracle for placement. Prelive should reproduce
that behavior locally, then persist copies through the same write path as other new draft notes.

## Proposed Delivery Slices

### Slice 1: reconciliation only

- Freeze editing and repeated submission while writing/verifying.
- Await exact refetch after success.
- Reset the baseline from fetched Live data and clear the draft, IDs, selection, and change tracking.
- Refetch after any failure before allowing another write.
- Distinguish write failure from verification failure in the UI.
- Verify success, each partial-failure boundary, unchanged-data refetch, and refetch failure.

This is the immediate implementation recommendation.

The repository currently has no test runner, test script, or test sources. Adding a framework solely
for this slice is a separate tooling decision. If no runner is introduced, extract payload
partitioning and reconciliation transitions into pure functions suitable for later tests, then use a
documented manual failure matrix plus `pnpm typecheck` and `pnpm lint` for this slice. The highest-value
future automated cases are temporary-ID uniqueness, partial failure after each write phase, and retry
prevention after a successful add.

### Slice 2: Live behavior characterization

- Run the eight-case disposable-clip matrix.
- Record the resulting placement and marker behavior in this document.
- Decide whether exact Live parity or the documented grid-rounded fallback is the product rule.

### Slice 3: local Duplicate

- Add the one-copy operation and Cmd/Ctrl-D.
- Select copies and preserve all note fields.
- Surface pending playback-boundary extension.
- Write boundary first, then note phases, followed by mandatory reconciliation.

### Slice 4: local history

- Move toward baseline plus derived diff if necessary.
- Add bounded past/present/future snapshots.
- Bind Cmd/Ctrl-Z and Cmd/Ctrl-Shift-Z only to draft history while the editor owns focus.
- Make every operation and completed scrub gesture one history entry.
- Clear history on verified write, Discard, and clip change.

## Decision Points

Before implementation, approve or revise these choices:

1. Reconciliation ships separately and first.
2. Initial Duplicate may ship before local undo because it is additive and selects its copies.
3. Cmd/Ctrl-D copies empirically observed Live placement, not an assumed bounding-span formula.
4. Automatic playback extension intentionally differs from ordinary Live note Duplicate.
5. Playback extension rounds to the next full clip bar by default.
6. Arrangement clips are excluded until their boundary behavior is verified.

## Sources

- Current editor: `src/components/NoteListEditor.tsx`, `src/components/NoteTable.tsx`
- Current write path: `src/lib/LiveSet.ts`, `src/lib/serverFns.ts`
- Existing operation roadmap: `docs/note-list-editor-development-research.md`
- Live MIDI editing: `refs/live-manual/en/live-manual/12/editing-midi/index.md`
- Live clip playback and loops: `refs/live-manual/en/live-manual/12/clip-view/index.md`
- Live Object Model Clip: <https://docs.cycling74.com/apiref/lom/clip/>
- Live Object Model Song: <https://docs.cycling74.com/apiref/lom/song/>
- TanStack Query invalidation:
  `refs/tan-query/docs/framework/react/guides/invalidations-from-mutations.md`
- TanStack Query query client: `refs/tan-query/docs/reference/QueryClient.md`
