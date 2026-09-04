# Note List Editor: Adding, Inserting, and Multi-Edit Research

Date: 2026-09-04

Research questions, from the toolbar in the current build (`Relative | Absolute`, `Add note`,
`Duplicate...`, `Delete selected`, plus the `Mute` and `More` columns):

1. What do Relative and Absolute mean, how do they affect edits, and do we need the toggle?
2. Mute and More are noise in the basic view. What is a better way to handle them?
3. `Add note` appends at the end of the clip. How do Logic, Cubase, Digital Performer and Live
   add and insert notes, and what would give Prelive more powerful ways to add notes?

Sources: `Refs/logic-manual/guide/logicpro/*` (Logic Pro 12.3 Event List chapters),
`Refs/cubase-manual/operation-manual/midi-editors.md` (List Editor, Key Editor, Step Input),
`Refs/performer-manual/SIRA/Digital_Performer_Help/pages/*` (Event List, Edit/Region menus,
Step Record), `Refs/live-manual/en/live-manual/12/*` (chapters 10, 11, 19, 41), Astryx
`refs/astryx/packages/core/src/Table/*`, and Prelive's `src/components/NoteListEditor.tsx`,
`src/components/NoteTable.tsx`, `src/lib/noteEdits.ts`. Research was gathered by four sub-agents,
one per manual; quotes below are verbatim from the local copies.

## Summary

- **Relative vs Absolute** only matters when more than one row is selected and you edit a field.
  Relative applies the delta to every selected note (differences preserved); Absolute sets every
  selected note to the typed value. Logic and Cubase both default to relative and reach absolute
  with a modifier held while dragging (Cubase `Ctrl/Cmd`, Logic `Option-Shift`). Neither has a
  mode toggle. Recommendation: keep relative as the default, make absolute a modifier on commit
  and a context-menu / dialog action for "Set all selected to...", and drop the segmented control.
- **Mute and More**: Logic keeps mute as a one-character `M` column and hides release velocity
  behind an "Additional Info" toggle. Cubase has no mute column at all (mute is a tool; muted rows
  are dimmed). Performer shows off-velocity as a plain column. Recommendation, matching the
  decision to hide both: a "Details" toggle that adds Mute, Probability, Velocity Deviation, and
  Release Velocity as real editable columns (Astryx `useTableColumnSettings`), with muted rows
  still visibly dimmed in the basic view so the state is never silently invisible.
- **Add / insert**: no DAW event list inserts "between rows". All four insert _at a time
  position_ (playhead, insert marker, step-input cursor, or a typed position) and re-sort. The
  common power features are: a new note inherits the last edited/created note's length and
  velocity (Logic, Cubase); a step-input cursor that advances by a step after each insert
  (Cubase, Logic, Live, Performer); an "insert mode" that pushes later notes right (Cubase Move
  Insert Mode, Performer Splice, Logic Copy Insert, Live Insert Time); Repeat N copies (Logic,
  Cubase, Performer); and paste with a typed destination (Logic). Recommendation: a row context
  menu with "Insert before / Insert after" (the after-cursor case is what `Add note` does now,
  anchored to the selected row instead of the last row), a `Shift+Enter`-style "add after current
  row" keyboard path, an "Insert at position..." dialog reusing the Duplicate dialog's
  position input, a `Repeat...` command, and an optional step-entry mode later.

## 1. Relative vs Absolute

### What Prelive does today

`src/components/NoteListEditor.tsx` `commitField`:

```ts
const isGroupEdit = selectedKeys.has(String(noteId)) && selectedKeys.size > 1;
const apply = (note: Note): Note => ({
  ...note,
  [field]:
    isGroupEdit && multiEditMode === "relative"
      ? clampField(field, note[field] + next - current[field])
      : clampField(field, next),
});
```

- A group edit happens only when the edited row is itself selected **and** at least two rows are
  selected. Editing an unselected row never touches the selection.
- Relative: the difference between the new and old value of the edited row is added to every
  selected note, then each is clamped independently. Select three notes at velocity 60, 80, 100,
  scrub the first to 70, and you get 70, 90, 110. Scrub the first to 0 and you get 0, 20, 40
  (the delta is -60; nothing pins the others).
- Absolute: every selected note gets the typed value. Same selection, type 70 in any row, all
  three become 70.
- Applies to pitch, start, duration, and velocity alike. Relative on start is "shift the
  selection"; absolute on start is "stack every selected note at the same time", which is rarely
  wanted. Relative on pitch is transpose; absolute on pitch is "make a unison".
- Mute is not part of the mode: `toggleMute` only ever changes the one row clicked.

So the toggle does matter, but only in a multi-select edit, and only for one of the two operations
per commit. It sits in the toolbar as a permanent global mode, which is what the user finds
confusing: nothing changes when you click it unless several rows are selected.

### Logic Pro Event List

`Refs/logic-manual/guide/logicpro/change-event-values-lgcp215851db/12.3_/mac/15.md`:

> If a parameter of one of several selected events is altered, it affects the same parameter in
> all events within the selection group. When you alter parameter values in a group of selected
> events, the relative differences between parameter values remain unchanged.
> Parameter values can only be altered until the (same) parameter value of one of the selected
> events has reached its maximum or minimum value.

> - In Logic Pro, Option-drag the value.
>   This technique allows you to continue altering a parameter value in a multiple selection, even
>   when one of the selected events has reached its maximum or minimum value.

> ## Set a parameter to the same value for all selected events
>
> - In Logic Pro, press and hold Option-Shift while dragging the value.

Three behaviours, all reached by modifier, none by mode:

| Gesture           | Behaviour                                                         |
| ----------------- | ----------------------------------------------------------------- |
| Drag              | Relative, clamped as a group: stops when any note hits min or max |
| Option-drag       | Relative, clamped per note: the others keep moving                |
| Option-Shift-drag | Absolute: every selected event gets the value                     |

Prelive's relative is Logic's _Option-drag_ variant (per-note clamp). Logic's default is the safer
one: a group transpose that would push one note past G8 stops the whole group, so the chord shape
survives.

### Cubase List Editor and Info Line

`Refs/cubase-manual/operation-manual/midi-editors.md`, "Editing in the Event List":

> - To edit the values of several events, select the events, and edit the value for one event.
>   The values of the other selected events are also changed. Any initial value differences
>   between the events are maintained.
> - To set all selected events to the same value, press `Ctrl/Cmd`, and edit the value for one
>   event.

Same rule on the Key Editor info line:

> - To apply a value change to all selected note events, press `Ctrl/Cmd`, and change a value on
>   the info line.
>   Note: If you selected several note events and you adjust a value, all selected events are
>   changed by the set amount.

So Cubase: default relative, `Ctrl/Cmd` while editing = absolute. Cubase also documents an
interesting detail for typed entry on the info line: "If several notes are selected, the values
for the first note are displayed in color", meaning the field shows one note's value and the edit
is interpreted as a delta from that. That is exactly Prelive's `next - current[field]`.

### Digital Performer

The local DP help documents selection (`Shift-click` range, `Command/Win-click` non-adjacent) but
says nothing about what happens when a value is edited with several events selected. Bulk changes
are Region-menu commands (Change Velocity, Change Duration, Transpose) whose option wording is not
in the local copy, and Shift is documented as an explicit pair:

> The shift distance can be specified in one of two ways:
>
> - Shift by amount — lets you specify a number of measures and/or a quarter notes|ticks
>   duration...
> - Shift to time or marker — lets you specify an exact location...

That is the same relative/absolute split, expressed as two fields in a dialog rather than a mode.

### Live

Live has no note list, but its multi-select value editing is consistent with the others.
`Refs/live-manual/en/live-manual/12/editing-midi/index.md` §10.5.12:

> To set a group of notes so that they all have the same velocity, select their markers in the
> Velocity Editor, drag them up or down to either maximum or minimum velocity, and then adjust
> velocity to the desired value.

Dragging is relative; the documented way to get absolute is to saturate the group at a limit
(Logic's group clamp, used on purpose). Typed entry is absolute: "Set Note Selection Velocity |
Type a value between 0-127 and press Enter" (§41.12). Velocity Deviation and Chance show a range
when the selection differs and adjust relative to each note.

### Recommendation

1. **Remove the segmented control.** No DAW has a mode for this, and a global toggle whose effect
   is invisible until a multi-select edit is the wrong shape.
2. **Default relative on scrub and on typed entry**, as today, but with Logic's group clamp: stop
   the whole group when any note would leave its range, rather than clamping each note
   separately. This keeps intervals intact and is what Logic and Cubase both describe.
3. **Absolute via modifier on commit**: `Cmd`/`Ctrl` held while scrubbing or when pressing Enter
   applies the typed value to every selected note (Cubase's exact gesture). The scrub hook already
   sees modifier keys.
4. **Absolute via an explicit action** for discoverability: a row/selection context-menu item
   "Set velocity of 3 notes to..." (and the same for pitch and duration) that opens a small
   dialog. Live's Note Duration utility ("You can set the same note duration, or length, for all
   selected notes") and Performer's Region commands are this shape. Start should probably not
   offer absolute at all; "Move selection to position..." (Performer's "Shift to time") is the
   meaningful version, and it is relative under the hood.
5. Show the multi-edit affordance where it applies: when the edited row is part of a multi-row
   selection, the field could show "3 notes" in a tooltip or the toolbar status text so the user
   knows the commit will fan out.

## 2. Mute and More

### What the DAWs do

| DAW       | Mute                                                                                                              | Secondary note fields                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logic     | Narrow `M` column; click the cell; "An 'M' appears in the Mute column of muted note events."                      | Release velocity only with the **Additional Info** button: "The Event List is normally restricted to one line per event. When the Additional Info button is on, however, all information stored along with the event is also shown." |
| Cubase    | No column. Mute tool; "Muted notes are dimmed in the note display."                                               | Off velocity is the always-visible **Secondary Value** column. No per-column hide; filter bar hides by event _type_.                                                                                                                 |
| Performer | Not a column in the local help.                                                                                   | On velocity, off velocity, duration always shown. View Filter hides event types, not columns.                                                                                                                                        |
| Live      | Not a list. `0` toggles Deactivate Note(s); "When a note is deactivated it is grayed out and will not be played." | Probability, Velocity Deviation, Release Velocity each have their own lane or slider in the Notes tab; hidden until you open that lane.                                                                                              |

Two patterns matter: **muted notes are visually dimmed everywhere** (Cubase, Live, and Logic's
"M" glyph), and **secondary fields are behind a single toggle** (Logic's Additional Info, Live's
lanes). Nobody uses a per-row expander for note data; every extra field is a column.

### What Prelive does today

`src/components/NoteTable.tsx`: `Mute` is a 64 px checkbox column, `More` is a read-only text
summary (`p 0.5`, `±10`, `rel 100`) that is blank for default values and is not editable at all.
So the basic table has two columns that are mostly empty and one of them cannot be edited.

### Recommendation (basic view hides both)

1. **Details toggle** in the toolbar (icon toggle, `Cmd+Shift+I` or similar), default off.
   Off: `#`, select, Pitch, Start, Duration, Velocity. On: adds Mute, Probability, Velocity
   Deviation, Release Velocity as four editable columns (scrubbable numbers, same
   `ScrubbableNumberInput` path as Velocity). Persist the choice in `localStorage` so it survives
   reload. Astryx supports this directly: `useTableColumnSettings` is "Headless column visibility
   and ordering management for Table" with `activeColumnKeys` and `isAlwaysVisible` per column.
   This replaces the `More` summary column outright.
2. **Dim muted rows in every view.** Astryx `useTableRowStatus` or a row-level style through the
   selection plugin's `transformBodyRow` can render the muted row's text in `color="secondary"`.
   Then hiding the Mute column loses no information, exactly as in Cubase and Live.
3. **Mute stays reachable without the column**: the row context menu gets "Deactivate note(s)"
   / "Activate note(s)" for the selection, with the `0` hotkey to match Live ("select it and press
   0"). This also fixes the current asymmetry where mute is the only field that ignores
   multi-selection.
4. Probability and the rest keep their current defaults on `Add note` (1, 0, 64) so a user who
   never opens Details never sees them.

## 3. Adding and inserting notes

### What Prelive does today

`NoteListEditor.tsx` `addNote`: takes the **last row in musical order**, and appends a note at
`last.start_time + last.duration` with the last row's pitch, duration, and velocity (C3, 1 beat,
100 when the clip is empty). Then re-sorts. There is no way to choose where the note goes except
to add it and then edit Start. `Duplicate...` covers copy-to-position for a selection.

Observations: the defaults copy the _last_ note, not the _selected_ or _last edited_ note, so
adding a note while working in bar 2 of an 8-bar clip lands it in bar 9. And the note is neither
selected nor scrolled into view.

### Logic Pro Event List

Insertion is at the playhead, with the new event selected:

`.../create-events-in-the-event-list-lgcp2158295a/12.3_/mac/15.md`

> 1. In Logic Pro, move the playhead to the insert position.
>    The current playhead position is used as the insert position if it's not moved.
> 2. Choose an event type from the Event Type pop-up menu.
> 3. Click the Add Event button (+).
>    The event is added at the playhead position, and is automatically selected.

Paste asks for a position rather than using the playhead, which is unique to the list:

> Enter a destination position for the first event in the input box that appears. If you press
> Return, the original position of the first event is retained and used. The relative positions
> of other copied events are maintained.
> **Important:** The position input box is unique to the Event List. Pasted events are not
> automatically added at the playhead position, as is the case in the graphical editors.

The manual's own "duplicate a row" recipe is Copy Event / Paste Event from the Status column's
shortcut menu, then type the position. Default values for a new note are documented only for the
Piano Roll, but they are the model to copy:

`.../add-notes-lgcpa904cb3a/12.3_/mac/15.md`

> The newly created note's length, velocity, and channel match that of the previously created or
> edited note event. When you start a new project, the default values are a length of 240 ticks,
> a velocity of 80, and MIDI channel 1.

with a "Define as Default Note" command, and "Editing an existing note also defines it as the
default note."

Other Logic pieces: the list re-sorts after any position edit ("As soon as you alter the position
of an event, the list is automatically re-sorted. The currently selected event remains
highlighted."); position typing accepts partial input from the left ("you can enter the bar number
only, and press Return"); `Repeat Events` (Cmd-R) asks for a count; and the Copy MIDI Events
dialog has a _Copy Insert_ mode: "All data at the destination position is moved to the right, by
the length of the source area." Step input (MIDI In button) inserts at the playhead and advances it
by the chosen note length, with a Chord button that stacks notes without advancing.

### Cubase List Editor and Step Input

The List Editor has no "add row" affordance. New events are drawn in the event display to the
right of the list, at the clicked time:

`Refs/cubase-manual/operation-manual/midi-editors.md`, "Drawing Events"

> The **Draw** tool allows you to insert single events in the event display.
> ... The note event is set to the length specified in the **Length Quantize** pop-up menu.
> Notes assume the insert velocity value set in the **Note Insert Velocity** field on the toolbar.

> The vertical position of an event in the display corresponds to its entry in the list, that is,
> to the playback order. The horizontal position corresponds to the actual event position in the
> project.

So Cubase's "insert between rows" is "click at a time between those two rows' times". Editing
Start re-sorts: "If you move the event past any other event in the list, the list is resorted."

Step Input is the power path, and it is the only place any of the four manuals documents pushing
later notes right on insert:

> **Step Input** allows you to insert note events or chords one at a time, without worrying about
> the exact timing.
> ... The note event or chord is inserted and the step input cursor automatically jumps to the
> next position on the timeline that is determined by the **Quantize** value.
> You can move the step input cursor manually by clicking in the note display, or by pressing
> `Right Arrow`/`Left Arrow`.
> Optional: To insert a rest, press the `Right Arrow` key.

> **Move Insert Mode**: Moves all note events to the right of the step input cursor to make room
> for the inserted event when you insert notes. This only works if **Step Input** is activated.

Duplicate / Repeat: `Ctrl/Cmd-D` places the copy "behind the original" keeping relative
distances; `Ctrl/Cmd-K` Repeat asks for a count; `Alt/Opt`-drag the right edge makes copies.
Paste vs Paste Time: "insert note events at the project cursor position without affecting existing
notes" vs "move and, if necessary, split the existing note events to make room".

### Digital Performer Event List

`Refs/performer-manual/SIRA/Digital_Performer_Help/pages/event_list.md`

> **Insert menu:** Chooses what kind of data will be inserted by the Insert button.
> **Insert button:** Inserts an event of the data type shown in the Insert menu. _Option/Alt-click_
> to reinsert another event of the type just inserted.

> **ReInsert:** Inserts an event of the same type that you last inserted.

Where the event lands and its defaults are not in the local help. Per-field editing is by
double-click or `Option`-click, and each field accepts typing or vertical drag, with Tab and arrow
keys moving between fields and Return confirming.

The Edit menu is explicit about what shifts time and what does not:

> The Cut command removes data in the selected region ... This does not remove the time region
> specified; instead, it leaves the measures blank (silent), without data events.

> The Snip command removes data in the selected region ... The time region containing the data is
> removed as well, closing up the gap.

> The Splice command inserts data on the Clipboard in the selected region, making a gap for the
> new data and moving pre-existing data later in time to make room for the new material.

> The Repeat command makes an internal copy ... then pastes, splices or merges this data
> repetitively immediately following the selected region.

Step Record is a separate window with a step size in ticks, a Duration percentage of the step,
Auto Step, and Backstep.

### Live

No list view exists. Notes are created by double-click or Draw Mode at a time and pitch, and the
insert marker is the position primitive:

`.../editing-midi/index.md` §10.5.2

> Clicking in the MIDI Note Editor selects a point in time, represented by a flashing insert
> marker. You can also move the insert marker to a specific location with the left and right arrow
> keys, according to the grid settings. Holding the Ctrl (Win) / Option (Mac) key while pressing
> the left or right arrow key moves the insert marker to the previous or next note boundary.

Step recording (§19.3.4) is arrow-driven: held keys are added when the right arrow is pressed,
holding across another arrow press extends them, the left arrow deletes. The time commands
(§10.7.2) are the shift primitives, and they never touch the loop: "_Insert Time_ inserts as much
empty time as is currently selected into the clip, before the selection"; "_Duplicate Time_
places a copy of the selected timespan into the clip, along with any contained notes"; "these
operations do not change the clip start/end position or the loop brace settings." Duplicate
(`Cmd-D`) on the loop brace doubles the loop and copies its notes, moving later notes to keep their
position relative to the loop end.

Live 12's Pitch and Time Utilities and MIDI Tools are the "generate many notes from a selection"
layer: Legato, Chop, Note Duration, Fit to Scale, Humanize, Reverse, and the Transformations
(Arpeggiate, Connect, Ornament, Quantize, Recombine, Span, Strum, Time Warp) and Generators
(Rhythm, Seed, Shape, Stacks). They act on "the time selection, note selection, or clip loop
(when there is no time or note selection)".

The default length of a new note is not stated anywhere in the manual. Observed behaviour is one
grid division, which Prelive deliberately does not track (see the clip-context research).

### Cross-DAW pattern

| Feature                                | Logic                         | Cubase                                    | Performer              | Live                            |
| -------------------------------------- | ----------------------------- | ----------------------------------------- | ---------------------- | ------------------------------- |
| Insert position                        | Playhead                      | Click time / step cursor                  | Insert button (undoc.) | Insert marker / double-click    |
| New note copies previous note's values | Yes (length, velocity, ch.)   | Toolbar Length Quantize + Insert Velocity | Undocumented           | Grid length                     |
| New note selected after insert         | Yes                           | Yes (drawn note)                          | Undocumented           | Yes                             |
| List re-sorts after Start edit         | Yes, selection kept           | Yes                                       | Implied                | n/a                             |
| Step entry that advances a cursor      | MIDI In + Step Input keyboard | Step Input (`→` = rest)                   | Step Record window     | `→` with held keys              |
| Push later notes right                 | Copy Insert (dialog)          | Move Insert Mode, Paste Time              | Splice                 | Insert Time, Duplicate Time     |
| Repeat N copies                        | Repeat Events (Cmd-R)         | Repeat (Cmd-K)                            | Repeat                 | Duplicate Loop / Duplicate Time |
| Paste asks for destination             | Yes, typed position box       | No (cursor)                               | No (counter)           | No (insert marker)              |
| Insert "between rows"                  | No                            | No                                        | No                     | n/a                             |

### Proposals, in rough order of value per effort

**A. Anchor `Add note` to the selection, not the end.** Behaviour: if rows are selected, insert
after the _last selected_ note (start = its end, values copied from it); otherwise keep the current
"after the last note" behaviour. Select the new row, keep focus in the table. This is Logic's
"previously created or edited note" default applied to the list, and it removes the "adds at bar 9"
surprise with no new UI. Keyboard: `Shift+Enter` or `Cmd+Enter` while a row is focused, so a user
can build a line by typing pitch, Enter, `Cmd+Enter`, pitch, Enter.

**B. Row context menu with Insert before / Insert after.** Astryx `Table` aggregates
`contextMenuActions` per row from plugins, so a small plugin can add: Insert note before (start =
row start, duration = row duration, row itself untouched, so the new note stacks at the same time,
which is how you add a chord tone), Insert note after (as A), Duplicate..., Delete, Deactivate.
Since every DAW inserts by _time_, "before" and "after" here mean "at this row's start" and "at
this row's end", which is the only meaning that survives the re-sort.

**C. Insert at position...** A dialog reusing `DuplicateNotesDialog`'s bar.beat.sixteenth input:
position, pitch, duration, velocity, count (1..n), and a "push later notes" checkbox. Defaults
from the selected row. Count with a step equal to duration gives Cubase Repeat and Performer
Repeat for free. The checkbox is Cubase's Move Insert Mode / Live's Insert Time: shift every note
with `start_time >= position` by `count * duration`. Live's caveat applies: do not touch the
loop brace or markers automatically; `requiredPlaybackRegion` already grows the region when a
write needs it.

**D. Repeat selection...** Cmd-K style: N copies of the selection placed end to end after it,
with optional push. This is `duplicateNotes` in a loop; the Duplicate dialog can grow a Count
field instead of adding a new dialog.

**E. Step-entry mode.** A toggle that shows an insert cursor (bar.beat.sixteenth) in the toolbar
with a step size and a default duration/velocity. `Enter` on a pitch inserts at the cursor and
advances by the step; `→` advances without inserting (a rest, Cubase's exact wording); `←`
steps back; `Shift+Enter` stacks a chord tone without advancing (Logic's Chord button). Optional
"push later notes" as in C. This is the largest item and mostly toolbar state plus reuse of C's
insert function, but it is the feature that makes a table a real entry tool rather than a
correction tool. MIDI-keyboard pitch entry (Cubase "play a note on your MIDI keyboard" into the
Pitch field, Logic MIDI In) needs Web MIDI in the browser and is a separate decision.

**F. Transform-style commands.** Live's Legato, Chop, Note Duration, Fit to Scale, and the
MIDI Tools operate on a selection and are natural context-menu items on a multi-row selection:
Legato (extend each selected note to the next note's start), Chop (split each into grid pieces),
Set duration... (the absolute action from section 1). Arpeggiate/Strum/Seed generate notes and
are further out. Fit to Scale waits on the per-clip scale fields (see the clip-context research).
None of the other DAWs' event lists offer these; they are Live's idiom, and a Live-native tool
should probably lean on them rather than on a Logic-style transform dialog.

Not recommended: a literal "insert an empty row between rows 4 and 5" in the table. No DAW does
it, the row would need a start time before it can be sorted, and B covers the same intent.

## Open questions

- Should absolute-on-modifier be `Cmd` (Cubase, but `Cmd` is also the scrub fine-tune modifier
  in some tools) or `Option+Shift` (Logic)? Check what `useScrub` already reserves.
- Group clamp (Logic default) vs per-note clamp (current): group clamp is safer for transpose but
  makes a large velocity scrub stall silently when one note is at 127. Logic solves it with
  Option-drag for the per-note case; Prelive may want the reverse default.
- Does "Insert before" (stack at the same time) or "Insert before, shifted earlier" match what
  the user expects? The former creates chords, the latter needs a duration to subtract and can
  produce a negative start.
- Whether the Details toggle should also expose `note_id` for debugging writes.
