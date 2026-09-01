# Note List Editor Development Research

Research question: how should the current Prelive note list editor develop, based on the earlier
Extension Prelive research and the Cubase, Logic Pro, Digital Performer, and Ableton Live manuals?

## Conclusions

The current editor has implemented most of the earlier research's first pass: stable row selection,
compact numeric cells, chronological resorting, relative and absolute multi-edit, add/delete,
musical time labels, and an explicit draft/write workflow. The next work should not be another table
redesign. It should make a selected set of notes into a useful musical operand.

Recommended sequence:

1. Make draft history and write reconciliation reliable.
2. Add grid-aware **Duplicate**, clip-boundary extension, group mute/unmute, transpose, and time
   nudge.
3. Make probability, velocity deviation, and release velocity directly editable.
4. Add vertical drag/scrub editing for numeric values.
5. Add fixed velocity, fixed duration, legato, quantize, and velocity ramp operations.
6. Add Find and Select by note properties.
7. Add audition only if LiveQL gains a safe note-preview operation.
8. Add copy/paste only after defining an insertion marker or explicit paste destination.

`Duplicate` is the best next selection operation. It requires no system clipboard. Duplicated notes
can remain local draft notes and flow through the existing `clip_add_new_notes` mutation. Extending
playback to include notes beyond the current clip boundary does require new LiveQL coverage for
`loop_end` and `end_marker`; `Clip.length` itself is read-only.

## Prior Research And Artifact

The source document is
`refs/extension-prelive/docs/note-list-editor-research.md`. It compared the list editors in Cubase,
Logic, and Digital Performer, then mapped their common patterns to Astryx. Its strongest conclusion
was:

> Multi-select edit is relative by default with a modifier for absolute ... and a `*`/range display
> for mixed values.

It also found broad agreement on chronological sorting, distinct select/edit gestures, exact numeric
editing, and note audition.

The recovered Claude Artifact is [Event List Anatomy](https://claude.ai/code/artifact/9f6a2caf-afee-4aca-8a81-719870295cab?org=407ec02e-f32c-42c4-8687-7c7bc743b83a).
It is a visual presentation of the earlier research, with annotated DAW screenshots, a side-by-side
interaction table, and an Astryx-based Prelive mock. The source document remains the durable textual
record because artifact access may require the owning Claude organization.

The artifact makes several design implications more concrete than the source document:

- Keep one non-editable safe target for row selection. Logic explicitly warns users to select from
  its Status column to avoid changing an editable value. Prelive's selection checkbox and row number
  should serve that role even after cells gain drag scrubbing.
- Preserve a compact four-column primary scan path: pitch, start, duration, and velocity. Expose mute,
  probability, deviation, and release velocity through an expandable details row, following Logic's
  Additional Info pattern, rather than making the default table eight columns wide.
- Treat display and edit representations separately. Musical note/time labels at rest and raw numeric
  values while focused fit Astryx `NumberInput.formatValue` and match the DAWs' behavior.
- Add typed signed deltas such as `+12` and `-3` after the relative-edit operation path is settled. A
  signed value changes every selection member relatively; an unsigned value uses Absolute mode.
- If filters are added, define whether they are only visual or also scope operations. Logic uses
  visible events as a safety boundary. Prelive should make that behavior explicit and should not let
  hidden selected notes be changed accidentally.
- Consider independently tabbable/scrubbable bar, beat, subdivision, and tick fields only as a later
  precision enhancement. The current single beats value with a musical resting label remains the
  simpler first implementation.
- An aligned velocity bar can improve scanning without replacing the exact numeric cell. It is a
  useful optional visualization, not a prerequisite for selection operations.

The artifact originally put drag-to-scrub in “Deliberately later” because Astryx has no native
scrubbing prop and wheel/arrows cover much of the interaction. This document now places scrubbing in
Phase 1: all four manuals support the gesture, and it is important enough to implement once as a
reusable `NumberInput` wrapper rather than indefinitely defer it.

Artifact image references include:

- Cubase overview: `refs/cubase-manual/_assets/list_editor_cubase_pro_nuendo.png`
- Cubase event/value panes: `refs/cubase-manual/_assets/midi_editors_list_editor_event_display.png`
- Digital Performer overview: `refs/performer-manual/SIRA/Digital_Performer_Help/imgs/event_list.png`
- Logic annotated Event List: the `9a0087af03af5fab88b59cc4d3078bba.png` asset named in the old
  research

These images and `refs/extension-prelive/docs/note-list-editor-research.md:244-269` contain the
artifact's underlying comparative analysis.

## Current Editor Audit

### Already implemented

| Earlier recommendation          | Current implementation                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| Stable chronological rows       | `byMusicalOrder` sorts by `start_time`, then `pitch`               |
| Explicit multi-selection        | Astryx `useTableSelection` keyed by `note_id`                      |
| Relative group editing          | Editing a selected row applies its delta to every selected note    |
| Absolute group editing          | `Relative / Absolute` segmented control                            |
| Numeric exact-value cells       | Click swaps the display button for an Astryx `NumberInput`         |
| Musical display values          | Pitch names and meter-aware position/duration labels               |
| Add/delete selection operations | Toolbar actions plus Delete/Backspace                              |
| Select all                      | Cmd/Ctrl-A                                                         |
| Draft before Live mutation      | Discard and Write to Live actions                                  |
| Stable identity for new notes   | Negative temporary note IDs                                        |
| Full-fidelity note transport    | Domain includes mute, probability, deviation, and release velocity |

Relevant code:

- `src/components/NoteListEditor.tsx:36-55` defines ordering and field limits.
- `src/components/NoteListEditor.tsx:97-119` implements relative/absolute group edits.
- `src/components/NoteListEditor.tsx:128-162` implements add and selected-note deletion.
- `src/components/NoteTable.tsx:248-321` defines the compact editable table.
- `src/lib/LiveSet.ts:177-207` writes new, modified, then removed notes through LiveQL.

### Remaining gaps from the old research

- Mute edits one row even when that row belongs to a multi-selection. Logic explicitly applies mute
  to "one or more selected note events" (`mute-and-delete-regions-and-events...:9-14`).
- Probability, velocity deviation, and release velocity are summarized in `More`, not editable.
- There is no mixed-value or selected-range summary outside the mode toggle.
- There is no row keyboard cursor, Shift-arrow range extension, or Escape-to-clear selection.
- There is no End column or start/end/duration display choice. Cubase derives End and Length from
  each other; Logic can show Length as the absolute note-off position.
- There is no note-name parser, sharp/flat/MIDI-number preference, drag scrubbing, or wheel editing.
- There is no selection audition. Live says its Preview switch sounds notes as they are "add[ed] or
  select[ed] and move[d]" (`editing-midi/index.md:105`).
- There are no selection filters or musical transformations.

### Reliability work before more destructive operations

The editor has a draft, but not undo/redo. Discard resets the complete draft only. Every compared DAW
treats note operations as undoable; Live describes note editing as non-destructive because Undo can
restore the previous clip state (`editing-midi/index.md:115-117`). A small in-memory past/present/
future history is more important than adding many destructive commands.

Write handling also needs a defined success state. `writeNotes` can issue three sequential mutations
for additions, modifications, and removals. This is not atomic: a later failure can leave Live partly
updated. On success, the current component invalidates clip queries but keeps the old draft and
temporary IDs mounted. Before adding transforms:

- Disable repeated writes while pending.
- After success, refetch and replace the baseline, clear history/selection/change sets, and remove
  temporary IDs.
- On partial failure, force a refetch and explain that Live may contain a partial write.
- Consider one LiveQL mutation only if LiveQL eventually exposes an atomic replace-notes operation.

Duplicate adds another cross-boundary concern. Live can store notes beyond the current start/end and
loop markers: `get_all_notes_extended` deliberately returns them. They will not necessarily be heard
when the clip plays. A write that adds such notes must also extend the appropriate playback boundary.
Those operations are not atomic in the LOM, so a failure after one operation requires a refetch and a
retryable partial-write state.

## What The DAWs Suggest For Note Selections

### Selection is the scope of every command

Live states the model directly:

> Your actions are selection-based: you select something ... then execute a command (e.g., Cut,
> Copy, Paste, Duplicate) on the selection.

Source: `refs/live-manual/en/live-manual/12/editing-midi/index.md:111-113`.

Digital Performer makes the same selection reusable across editors and operations. Its Event List
supports contiguous and non-contiguous selection, and its Region commands operate on selected data.
Cubase and Logic add property-based selection. The implication for Prelive is that transformations
should be pure operations from `selected notes -> replacement draft`, not bespoke behavior embedded
in table cells.

When no notes are selected, Prelive should disable selection operations. Live sometimes treats an
empty selection as "whole clip", but that is hazardous in a list where the operation toolbar is next
to Write to Live. An explicit **Select all** action is safer and more legible.

### Event selection and time-range selection are different

The current editor only has event selection. Other DAWs use time-range selection for commands whose
result depends on empty time or boundaries:

- Live's Duplicate Time copies a selected timespan and inserts it with contained notes
  (`editing-midi/index.md:535-542`).
- Digital Performer Repeat requires a time range, not an event selection
  (`edit_menu.md:73-77`).
- Digital Performer warns that exact reverse/retrograde needs a time range including the final note's
  duration (`region_menu.md:173-191`).

Do not overload selected rows to mean selected time. Add time-range state later if Prelive gains
Duplicate Time, Insert Time, Delete Time, exact reverse, or repeated fill. Ordinary Duplicate,
transpose, quantize, fixed values, and legato can operate on selected rows now.

## Recommended Operations

### 1. Duplicate selected

#### What the manuals and Live API actually establish

- Live's user manual names Duplicate as a note-selection command but does not define its offset
  calculation (`editing-midi/index.md:111-113`). It separately defines Duplicate Time, whose spacing
  is exactly the selected timespan (`editing-midi/index.md:535-542`), and Duplicate Loop, which
  doubles the loop and its contents (`editing-midi/index.md:552`).
- Live's LOM is more precise about the available operation. `Clip.duplicate_notes_by_id` accepts
  `note_ids`, optional `destination_time`, and optional `transposition_amount`. With a destination it
  places the selection there. Without one, notes are inserted "after the last selected note," the
  behavior seen in Live's GUI. It does not document the numerical formula for "after."
- Cubase says Duplicate places notes "behind the original," copies multiple notes as one unit, and
  preserves their relative distances. It says Snap affects duplication positions, but does not
  define the automatic offset equation (`midi-editors.md:389-406`). The generic Project-window
  description is equally qualitative: a copy is "placed after the original"
  (`parts-and-events.md:1233-1253`).
- Logic: copied Event List events preserve all values and prompt for the first destination position;
  other copied events retain relative positions (`create-events-in-the-event-list...:26-37`).

The manuals therefore do not justify the previous recommendation to always use the exact occupied
duration. That was an inferred policy, not documented Live behavior. Logic's explicit destination is
the strongest model for a list editor. Cubase contributes the useful requirement that relative
distances stay unchanged and the destination can honor a musical grid.

Recommended Prelive behavior:

- Enabled for one or more selected notes.
- Copy every selected note field except `note_id`.
- Compute selection start as the minimum `start_time`.
- Compute occupied span as `max(start_time + duration) - selection start`.
- Show **Spacing** and **Copies** controls. Spacing is the onset offset between each copy and defaults
  to the smallest whole number of duplicate-grid units that contains the occupied span:
  `ceil(occupied span / grid) * grid`.
- Default the duplicate grid to one beat (a quarter note in Live's beat units), while allowing common
  straight/triplet values and direct numeric entry. Remember the user's last value for the clip.
- Preserve every note's offset from selection start; do not quantize the notes themselves.
- Allow an explicit destination start as an alternative to relative spacing, following Logic and the
  LOM's `destination_time` model.
- Assign fresh negative IDs, merge and musically sort, select only the copies.
- Record the entire duplicate as one undo step.
- Label the one-copy action `Duplicate` and bind Cmd/Ctrl-D; open **Duplicate...** for count, grid,
  spacing, and destination options.

This makes the previously problematic case predictable. With one selected sixteenth note and a
quarter-note duplicate grid, its occupied span is one sixteenth but its default spacing rounds up to
one quarter. With an irregular performed phrase, internal timing stays intact while the repetition
period lands on a musical unit. Users can still request a smaller overlapping offset or a specific
destination.

#### Extending the clip playback boundary

Allow duplicates beyond the current clip length, then expand playback to include them. Do not attempt
to set `Clip.length`: the LOM marks it read-only and derives it from loop or start/end markers.

- For a looped Session clip, extend writable `loop_end`.
- For an unlooped Session clip, extend writable `end_marker`; `loop_end` also represents clip end for
  unlooped clips, but `end_marker` states the intent directly.
- Round the new boundary up to a visible musical unit, preferably the clip's bar by default, rather
  than creating an accidental fractional loop from a note tail. Offer the duplicate grid as a
  secondary boundary policy.
- Never shorten an existing boundary.
- Do not silently wrap duplicate notes.
- Treat Arrangement clips separately. `end_time` is read-only and represents the Arrangement clip's
  right edge; changing its internal end marker is not proven to resize that Arrangement region.

Current LiveQL exposes `length`, `end_time`, and `start_time` only for reading and exposes no
`loop_end` or `end_marker`. Add those Clip fields and a narrowly named mutation such as
`clip_set_playback_end`. LiveQL may also expose `duplicate_notes_by_id`, but Prelive should not use it
for draft duplication: it only accepts IDs already persisted in Live and would bypass local undo,
new notes, and unsaved modifications.

At write time, calculate `requiredEnd = max(start_time + duration)` across notes created or moved by
the current draft. Do not expand to untouched notes that were already stored outside the playback
markers. If the required end exceeds the current playback end, persist the notes and extend the
boundary as one user-visible write operation. This is several LOM operations even if LiveQL wraps
them in one composite GraphQL mutation. Neither form is truly atomic. If note insertion succeeds and
boundary extension fails, refetch so the out-of-range notes remain visible and let the user retry
extension; do not submit the notes again.

### 2. Group mute/unmute

Make mute selection-aware rather than treating it as a special single-row boolean. A toolbar command
or the `0` shortcut should follow Live's note deactivation convention
(`editing-midi/index.md:203-205`). Define mixed-selection behavior explicitly:

- If every selected note is muted, unmute all.
- Otherwise mute all.
- A row checkbox can keep editing only its row unless a selected-row interaction can be made clear.

### 3. Transpose and nudge

The current relative pitch and start cell edits technically perform these operations, but dedicated
commands make them fast and predictable:

- Semitone up/down and octave up/down, clamped to MIDI 0-127.
- Time earlier/later by a chosen nudge unit, preventing negative starts.
- Duration shorter/longer by the same unit, enforcing the current minimum.

Live uses arrows for time and pitch, Shift-Up/Down for octaves, and a modifier to bypass grid
snapping (`editing-midi/index.md:161-173,255-264`). Cubase exposes semitone/octave transpose palette
actions (`midi-editors.md:3562-3573`). Prelive should not take bare arrow keys until it has an
explicit row/cell focus model. Toolbar actions with documented shortcuts are safer first.

### 4. Edit the complete Live note model

Promote the three `More` values to editing UI:

- Probability: display 0-100%, store 0-1.
- Velocity deviation: signed range constrained so every resulting velocity stays legal.
- Release velocity: 0-127.

Keep the default table compact. A column visibility menu or expandable detail region is preferable
to permanently showing eight wide columns. The current `More` summary already provides a sensible
collapsed representation.

Probability group operations from Live are not currently representable because the current LiveQL
`Note` schema contains values but no probability-group identity/type. Do not mimic Play All/Play One
until the API can round-trip those relationships.

### 5. Numeric drag/scrub editing

This was present in the earlier Extension Prelive research but was underrepresented in the first
version of this roadmap. It is a strong cross-DAW convention, not a minor possibility:

- Cubase can make click-drag up/down its value-box mode; double-click remains text entry. It can also
  enable mouse-wheel parameter changes (`preferences.md:324-375`).
- Logic says Event List values use "the mouse as a slider or with text input," and position/length
  sub-units are changed by vertical drag (`change-event-values...:5-7`,
  `change-the-position-and-length-of-events...:11-23`).
- Digital Performer's Event List opens a field on double/Option-click and accepts either typing or
  dragging up/down (`event_list.md:13`).
- Live's numeric position fields support drag up/down, typing, and arrow keys
  (`arrangement-view/index.md:76`).

Recommended Prelive behavior:

- Vertical drag on a displayed numeric value scrubs it; double-click opens exact text/number entry.
- Use pointer capture and a movement threshold so a click never causes an accidental value change.
- Relative multi-edit remains the default; Absolute mode flattens selected values.
- Shift provides fine movement and a second modifier provides coarse movement, consistently across
  pitch, time, duration, velocity, probability, deviation, and release velocity.
- Render draft/score changes continuously, but create one undo entry on pointer release.
- Escape during a drag restores the pre-drag values.
- Keep arrow-key and typed-input alternatives for keyboard and assistive-technology users.
- Enable wheel stepping only when the cell is focused. Cubase explicitly disables wheel parameter
  editing in scrollable areas to avoid stealing table scroll, which is the right safety default here.

Astryx `NumberInput` already covers arrows, typing, limits, formatting, and optional wheel changes.
Drag scrubbing still needs a small wrapper or an Astryx extension; it should be implemented once and
used by every numeric note field.

### 6. Fixed values, legato, and velocity ramp

These are low-complexity, high-value transforms:

- **Set velocity**: absolute multi-edit with a named command. Logic has Fixed Velocity
  (`midi-transform-window-presets...:11`); Cubase has Fixed Velocity
  (`midi-functions.md:322-335`).
- **Set duration**: same for length. Logic provides fixed/min/max note length presets
  (`midi-transform-window-presets...:25-28`); Cubase uses its Length Quantize value.
- **Legato**: set each selected note's end to the next selected onset; define treatment per pitch,
  chords, and the final note. Live sets the final note to loop end (`editing-midi/index.md:333-335`),
  while Cubase supports a configurable gap/overlap. Start with **same-pitch next onset**, leave the
  final duration unchanged, then add a gap field if users need it. This avoids shortening every note
  in a chord to the next onset in a different voice.
- **Velocity ramp**: interpolate by chronological onset from a start velocity to an end velocity.
  Live distributes intermediate selected notes evenly between Ramp Start and End
  (`editing-midi/index.md:397`). Preserve equal values for simultaneous chord notes unless a later
  ordering option says otherwise.

### 7. Quantize with amount

Quantize is common to all products, but it should be an explicit transform rather than changing the
exact cell editor:

- Grid: at least 1/4, 1/8, 1/16, 1/32 and triplets.
- Target: starts; later starts and ends.
- Amount: 0-100%, using `original + (nearest grid - original) * amount`.
- Preview against the draft before Apply.
- Apply as one undo step.

Live explicitly supports start/end targets and an Amount that moves notes only partway to the grid
(`editing-midi/index.md:349-359`). Digital Performer distinguishes its exact Event List from grid
editing (`snap_info.md:25`). Therefore keep direct numeric entry exact; quantization belongs in an
operation panel.

### 8. Find and Select

Filtering the rows and selecting notes are different features. The most useful first feature is
**Find and Select**, because every subsequent operation benefits from it.

Live supports Pitch, Time, Chance, Condition, Count, Duration, Scale, and Velocity, including
combined and inverted filters (`editing-midi/index.md:135-159`). Digital Performer can save named
multi-criterion searches and add/subtract successive results (`searching.md:3-43`). Cubase can apply
Logical Editor presets as List Editor visibility criteria (`midi-editors.md:5590-5603`).

Recommended first predicates:

- Pitch or pitch range, optionally all octaves by pitch class.
- Start range.
- Duration range.
- Velocity range.
- Muted/unmuted.
- Probability below 100%.

Recommended combine modes: replace selection, add matches, subtract matches, and invert current
selection. Keep all rows visible initially; hiding rows changes the perceived scope and requires
strong filtered-state indicators.

### 9. Later transformations

Useful, but less urgent:

- Humanize start time, velocity, and duration with seeded randomization so Undo/reapply is
  understandable. Live currently humanizes start only; Logic and Digital Performer randomize all
  three (`midi-transform-window-presets...:19`, `region_menu.md:103-114`).
- Split and Chop notes. Live distinguishes one split from grid-based multi-part Chop
  (`editing-midi/index.md:207-239`).
- Join adjacent/overlapping same-pitch notes. Live preserves MPE contents; Prelive has no MPE model,
  so document that limitation before implementing (`editing-midi/index.md:241-245`).
- Remove exact duplicates. Logic erases duplicate events; Digital Performer includes a Remove
  Duplicates processor (`mute-and-delete-regions-and-events...:19-29`, `midi_plugins.md:55-57`).
- Reverse onset order, scale time, fit to scale, pitch inversion, and interval/harmonize.

These should use one shared transform contract and produce one undo entry each rather than adding
independent state machinery per command.

## Copy And Paste

Copy/paste is technically feasible in the client, but the current editor has no insertion marker,
playhead position, selected time range, or destination input. Other DAWs all have one:

- Live pastes at the insert marker (`editing-midi/index.md:165`).
- Logic's Event List asks for the first event's destination and preserves all relative positions
  (`create-events-in-the-event-list...:33-37`).
- Digital Performer uses the selection start or transport counter and can preserve measure-relative
  placement (`edit_menu.md:40-55`).

Adding Cmd/Ctrl-C and Cmd/Ctrl-V now would leave ambiguous behavior. Do one of these first:

1. Add a clip-relative insertion position to the toolbar, updated by a selected row or explicit time
   entry.
2. On Paste, open a small destination dialog defaulting to the earliest selected note's start or 0.

Then copy a versioned internal payload containing note values normalized to the earliest copied
start. Paste adds the destination to each relative offset, generates temporary IDs, and selects the
new notes. An in-app clipboard is sufficient initially. Writing custom data to the system clipboard
adds permission, focus, serialization, and cross-application compatibility questions without making
the musical operation better.

`Duplicate` should precede this because it answers the common same-clip case with no destination UI.

## Interaction Recommendations

- Keep single click for explicit row selection and a separate click to enter cell editing. The
  current button-to-input swap already prevents accidental scrub edits.
- Add Escape to cancel cell editing when editing, then clear row selection when not editing.
- Preserve selected IDs when a start edit resorts rows. The current keyed selection already does.
- Show selected count and a compact aggregate: one value when uniform, a range when mixed. Live
  shows ranges for mixed probability and velocity deviation.
- Apply boolean and extended-field edits to selection consistently; do not make multi-edit work only
  for the four primary numeric columns.
- Keep direct entry unsnapped. Expose nudge and quantize resolution separately.
- Add Undo/Redo controls and Cmd/Ctrl-Z / Cmd/Ctrl-Shift-Z before placing transforms in the toolbar.
- Put less frequent transforms in one `Operations` menu or panel. Do not grow the top toolbar into a
  button for every DAW command.
- Let users preview transforms against the local score immediately. Audio audition is separate and
  should never block deterministic draft editing.

## Proposed Operation Model

Every operation should consume immutable notes plus selected IDs and return the complete next note
array and next selection:

```ts
interface NoteOperationResult {
  readonly notes: readonly Note[];
  readonly selectedNoteIds: ReadonlySet<number>;
}
```

The operation layer should own clamping, temporary ID generation for copied notes, sorting, and
selection output. The editor should own history and Live write bookkeeping. This separates musical
rules from table gestures and allows transforms to be tested without rendering Astryx components.

Important invariants:

- Pitch is an integer from 0 through 127.
- Start is finite and non-negative.
- Duration is finite and at least the Live-supported minimum.
- Velocity and release velocity remain in their supported ranges.
- Probability remains from 0 through 1.
- Every draft row has a unique ID.
- Persisted IDs are modified or removed, never submitted as new note IDs.
- Newly created notes are submitted without temporary IDs.
- Operations preserve unselected notes byte-for-byte.
- One user command creates one undo entry.

## Delivery Plan

### Phase 0: safe editing foundation

- Add draft undo/redo history.
- Reconcile/refetch after writes and clear temporary state.
- Handle partial mutation failure explicitly.
- Extend LiveQL Clip coverage with `loop_end`, `end_marker`, and a playback-end mutation.
- Add selected count and Escape-to-clear.

### Phase 1: selected-note essentials

- Grid-aware Duplicate plus Cmd/Ctrl-D, explicit spacing/count, and playback-boundary extension.
- Group mute/unmute plus `0`.
- Semitone/octave transpose.
- Configurable time and duration nudge.
- Direct editing for probability, deviation, and release velocity.
- Vertical drag/scrub for all numeric fields, with one undo entry per gesture.

### Phase 2: musical cleanup

- Set velocity and set duration.
- Legato with documented same-pitch semantics.
- Velocity ramp.
- Quantize starts with grid and amount.
- Find and Select predicates.

### Phase 3: structural and creative tools

- Explicit insertion position, then internal copy/paste.
- Time-range selection and Duplicate/Insert/Delete Time.
- Humanize, split/chop/join, remove duplicates, reverse, scale time, fit to scale, and intervals.
- Audition if LiveQL exposes a suitable preview API.

## Sources

- Earlier analysis: `refs/extension-prelive/docs/note-list-editor-research.md`
- Recovered visual artifact: [Event List Anatomy](https://claude.ai/code/artifact/9f6a2caf-afee-4aca-8a81-719870295cab?org=407ec02e-f32c-42c4-8687-7c7bc743b83a)
- Current editor: `src/components/NoteListEditor.tsx`, `src/components/NoteTable.tsx`
- Current Live write path: `src/lib/Domain.ts`, `src/lib/LiveSet.ts`, `src/lib/serverFns.ts`
- Live Object Model Clip reference: <https://docs.cycling74.com/apiref/lom/clip/>; local LiveQL
  coverage audit: `refs/liveql/docs/lom-schema-research.md`
- Ableton Live: `refs/live-manual/en/live-manual/12/editing-midi/index.md`
- Cubase List Editor and note editing: `refs/cubase-manual/operation-manual/midi-editors.md`,
  `refs/cubase-manual/operation-manual/midi-functions.md`,
  `refs/cubase-manual/operation-manual/parts-and-events.md`,
  `refs/cubase-manual/operation-manual/preferences.md`
- Logic Event List: `refs/logic-manual/guide/logicpro/{create-events-in-the-event-list-lgcp2158295a,
change-event-values-lgcp215851db,change-the-position-and-length-of-events-lgcp215888c6,
mute-and-delete-regions-and-events-lgcp21583a54,midi-transform-window-presets-lgcp215831be}/12.3_/mac/15.md`
- Digital Performer: `refs/performer-manual/SIRA/Digital_Performer_Help/pages/{event_list,edit_menu,
region_menu,searching,snap_info}.md`
