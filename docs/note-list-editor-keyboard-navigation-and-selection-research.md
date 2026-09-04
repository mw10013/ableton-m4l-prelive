# Note List Editor: Keyboard Navigation and Selection Research

Date: 2026-09-04

Research questions:

1. How does Logic's Event List handle keyboard navigation? Can you move through the list, go into a
   field, change a value and keep going without touching the mouse? Is it Tab, arrows, or both?
2. How does Logic select events: single, multiple, range, drag, and is there a gutter to click?
3. Which of this makes sense for Prelive's note table, given that Start and Duration are
   bars.beats.sixteenths fields with their own inner navigation?

Sources: `refs/logic-manual/guide/logicpro/*` (Logic Pro 12.3 Event List chapters: overview,
interface, select events, change event values, change position and length, create events, mute and
delete, pointer shortcuts, global key commands), `refs/performer-manual/.../pages/event_list.md` and
`event_info.md` (Digital Performer), `refs/cubase-manual/operation-manual/midi-editors.md` (List
Editor), Astryx `refs/astryx/packages/core/src/Table/*`, and Prelive's `src/components/NoteTable.tsx`,
`src/components/BarBeatSixteenthInput.tsx`, `src/components/useScrub.ts`. Quotes are verbatim from
the local copies.

## Summary

- **Logic has no keyboard field cursor.** Its Event List keyboard model is *select the event with
  Left/Right Arrow, then use the mouse on a field*. Values change by dragging (per unit for
  position/length) or by double-clicking a field and typing, with Return to exit. The manual documents
  no Tab, no arrow-between-columns, and no "open the field of the selected event" key. Tab in Logic
  is "Cycle Through Window Views".
- **Logic's selection is Finder-like, with a twist.** Click an event to select it, drag over rows for
  a range, Shift-click to add without losing the previous selection, Left/Right Arrow to select the
  previous/next event, Shift+Arrow to extend, plus a large Edit > Select menu (All, All Following,
  Invert, Same Pitch, Same Subposition...). There is no checkbox gutter. The manual tells you to click
  the **Status column** (the event-type name) to select "to avoid any unintentional parameter
  alterations", because every other column is a live drag field. The Lock and Mute columns are
  click-to-toggle gutters, not selection handles.
- **Digital Performer is the model for field-to-field keys.** Its Event Info page states the
  convention outright: "using the Tab key and arrow keys to move from field to field and press
  return to confirm any changes". Selection: click, Shift-click for a range, Command-click for
  non-adjacent.
- **Prelive already has half of this by accident.** Every cell is a focusable `spinbutton`, so Tab
  already walks every field; Enter/Space/digit open the editor; Up/Down step; Escape cancels; the
  time field has Left/Right segment hopping and `.`/`,`/space to jump segments. What is missing:
  arrow keys between cells, Tab that commits *and* moves on, any keyboard selection, Shift-click and
  drag ranges, Delete on the selection, and grid semantics so the table is one Tab stop rather than
  one per cell.
- **Recommendation:** adopt the WAI-ARIA grid pattern with Logic's "navigation is selection" twist.
  One Tab stop for the table; Up/Down move the current row and, like Logic's Left/Right, also set the
  selection to that row; Shift+Up/Down extend the range; Left/Right move between columns;
  Enter/F2/digit open a cell; inside a cell Enter commits and stays, Tab/Shift+Tab commit and move
  to the next/previous cell, Escape cancels; Delete removes the selection. Selection by pointer:
  click a gutter (the row-index column, replacing the checkbox) selects, Shift-click ranges,
  Cmd-click toggles, drag in the gutter sweeps a range. The time field needs nothing new inside edit
  mode; Left/Right already move segments there and Tab leaves the cell.

## 1. Logic's Event List

### Layout and columns

"The Event List L(ock), M(ute), Position, Status, Ch(annel), Num(ber), Val(ue), and Length/Info
columns display all details of all event types. In most cases, you can directly edit the data
displayed (except for the Status column, which indicates the event type)."

For a note: Ch is MIDI channel, Num is pitch, Val is velocity (1..127), Length/Info is the length.
Release velocity is hidden behind the "Additional Info" button. Lock and Mute are single-glyph
columns: "Click in the Mute column for the selected events" toggles an `M`; "Click in the Lock column"
toggles a padlock. Both act on *the selection*, so they double as bulk toggles.

Columns can be reordered by dragging headers and resized at the dividers; Control-click a header for
"Reset to Defaults".

### Selection

From "Select events in the Event List":

> "you can use any of the standard selection techniques in the Event List: individual selection by
> clicking events, multiple selection by dragging, or both of these (without altering the previous
> selection), in conjunction with the Shift key."

> "**Tip:** When selecting events with the Pointer tool, you should click the event name in the
> Status column, to avoid any unintentional parameter alterations."

So: no dedicated selection gutter. The Status column is the safe click target because it is the one
non-editable column. Drag over rows makes a range. Shift preserves the previous selection.

Keyboard:

> "press the Left Arrow key to select the previous event, or the Right Arrow key to select the next
> event. Press and hold the respective arrow key to scroll through the list."

> "press and hold Shift and press the Left or Right Arrow key. Keep both Shift and the arrow key held
> down to select multiple events."

Note that the axis is Left/Right, not Up/Down, even though the list is vertical. Up/Down are the
global "Select Previous/Next Track" commands and Logic keeps them for tracks everywhere.

Audition on selection: "If the MIDI Out button (Output button) is on (it's on by default), every
newly selected event is played. This allows you to scroll (or play) through the list and audibly
monitor events as they are selected."

Edit > Select menu commands (all reachable from the list): All (Cmd-A), All Following (Shift-F), All
Following of Same Pitch, All Inside Locators, Invert Selection (Shift-I), Muted Events (Shift-M),
Overlapped Events, Same-Colored, Equal Events, Similar Events (Shift-S), Same MIDI Channel, Same
Subposition (Shift-P), Highest Notes (Shift-Up), Lowest Notes (Shift-Down), Previous Event (Left),
Next Event (Right), Deselect All (Option-Shift-D). A right-click menu carries selection and edit
commands too.

### Changing values

Two ways, both pointer-initiated:

> "You can change the event values shown in the Event List Value, Number, and Channel columns by
> using the mouse as a slider or with text input."

Position and length:

> "Double-click the position indicator (in the Position column), then enter a new value. Press Return
> to exit the field."
> "Drag the specific position unit vertically. Release the mouse button when you're finished."

Typing rules for bars/beats/divisions/ticks:

> "Numerical input starts from the left (which means you can enter the bar number only, and press
> Return, if you want to move an event to the beginning of a specific bar, when entering a value).
> The units can be separated by either spaces, dots, or commas, allowing you to type 3.2.2.2 or
> 3, 2, 2, 2 or 3 space 2 space 2 space 2."

That is the convention `BarBeatSixteenthInput` already implements (partial input from the left,
`.`/`,`/space as separators).

Modifiers while dragging (from "Pointer shortcuts for the Event List"):

| Function | Modifier |
| --- | --- |
| Change values in larger increments | Shift while dragging |
| Override a parameter's max/min limit in a multi-selection | Option while dragging |
| Set parameter to the same value for all selected events | Option-Shift while dragging |

Group edits are relative by default: "If a parameter of one of several selected events is altered,
it affects the same parameter in all events within the selection group... the relative differences
between parameter values remain unchanged." This is the relative/absolute behaviour covered in the
add/insert research doc.

Re-sorting: "As soon as you alter the position of an event, the list is automatically re-sorted. The
currently selected event remains highlighted." The selection follows the event, not the row index.

### What Logic does not document

- No key to move focus between columns. No Tab between fields. Tab is "Cycle Through Window Views"
  globally.
- No key to open the field of the selected event for typing. Text entry starts with a double-click.
- No Home/End, no page keys for the list.
- The only pure-keyboard path is: arrow to the event, then Delete, Control-M (mute), Cmd-C/Cmd-V
  (paste asks for a position in "the input box that appears"), or a Select menu command. Value
  editing always begins with the mouse.

Logic's answer to "edit everything from the keyboard" is therefore *not* the Event List. It is
MIDI-In step entry (the MIDI In button plus a music or computer keyboard) for creating notes, and
mouse-as-slider for adjusting them.

## 2. Digital Performer and Cubase for comparison

Digital Performer's Event List (`event_list.md`):

> "**Text box:** Appears when you double-click or Option-click on a field of an event. You can enter a
> new value for the field by either typing or by dragging up or down."
> "**Selected Events** Click an event to select it. *Shift-click* to select a range of events.
> *Command/Win-click* to select non-adjacent events."

And its Event Information window, which is "a single line of the Event List" in the same way as
Logic's Event Float:

> "The same editing conventions as the Event List apply, such as using the Tab key and arrow keys to
> move from field to field and press return to confirm any changes you have made."

So DP has exactly the interaction asked about: open a field, Tab to the next field, keep typing,
Return to confirm. DP's selection is also the classic Finder model with Shift for range and Cmd for
toggle, which is more predictable than Logic's Shift-adds-without-clearing.

Cubase's List Editor documents no keyboard navigation for the list. Its contribution is the toolbar
nudge set (Move Left/Right, Nudge Start/End) that acts on the selection by the snap grid, and the
same auto-resort rule: "If you move the event past any other event in the list, the list is
resorted."

## 3. Where Prelive stands today

`src/components/NoteTable.tsx` and `src/components/BarBeatSixteenthInput.tsx`:

| Interaction | Today |
| --- | --- |
| Tab | Moves to the next focusable thing: every cell is `tabIndex={0}`, so Tab walks all cells of all rows, plus the Astryx scroll wrapper (`role="group" tabIndex={0}`) and the row checkboxes. |
| Enter / Space on a cell | Opens the editor (`NumberInput` or `TextInput`). |
| Typed digit on a cell | Opens the editor pre-filled with that digit. |
| Up / Down on a cell | Steps the value and commits immediately (1 for numbers; a sixteenth, Shift for 1/128, for time). |
| Left / Right on a cell | Nothing. |
| Inside the time editor | Left/Right select the previous/next segment; `.`, `,`, space hop to the next segment; Up/Down step the segment under the caret; Enter commits (Cmd for absolute); Escape cancels. |
| Inside the number editor | Enter commits (Cmd for absolute); Escape cancels; blur commits. |
| Tab inside an editor | Blur commits and focus goes wherever the browser sends it; the next cell is not re-opened. |
| Row selection | Astryx `useTableSelection` checkbox column only. No click-on-row, no Shift-click range, no Cmd-click, no drag, no keyboard. |
| Delete | Toolbar button only. No Delete/Backspace key. |
| Audition | None. |

`useTableSelection` is a synthetic checkbox column (`transformColumns`), with select-all in the
header and a per-row `CheckboxInput` labelled by `getRowLabel`. It has no shift-range logic and no
keyboard handling. Astryx's `Table` renders a plain `<table>` with no grid roles; body rows and
cells are reachable through `transformBodyRow(props.htmlProps)` and `transformBodyCell`, which is
enough to attach `onClick`, `onKeyDown`, `aria-selected`, `role` and `tabIndex` without forking.

## 4. Recommendation for the note table

Two layers, as in the WAI-ARIA grid pattern: a **navigation layer** where arrow keys move a single
focused cell, and an **edit layer** you enter on purpose and leave with a commit or cancel. Logic's
one idea worth stealing is that navigation *is* selection: moving the current row with the arrows
also selects it, so there is no separate "and now select" step for the common case.

### Navigation layer (table has focus, no editor open)

| Key | Action |
| --- | --- |
| Tab / Shift+Tab | Enter or leave the table. One Tab stop, roving `tabIndex` on the current cell. |
| Up / Down | Move the current row. Selection becomes that single row (Logic: "Left Arrow to select the previous event"). Holding the key auto-repeats through the list. |
| Shift+Up / Shift+Down | Extend the selection range from the anchor row (Logic: Shift+Arrow). |
| Cmd+Up / Cmd+Down | Move the current row without touching the selection (Finder-style escape hatch for "look but don't select"). Optional. |
| Left / Right | Move the current cell across columns within the row. Wraps are not needed. |
| Home / End | First / last cell in the row. Cmd+Home / Cmd+End: first / last row. |
| Enter, F2, Space | Open the current cell for editing (all three already open today except F2). |
| Typed digit | Open the cell pre-filled (already today). For Pitch, a typed letter `A`..`G` could also open pre-filled; not required. |
| Up / Down with a modifier, or Alt+Up/Down | Step the value in place without opening, since plain Up/Down now moves rows. Alt+Up/Down is the natural choice on macOS. Shift+Alt for the fine step. |
| Delete / Backspace | Delete the selected rows (Logic: "Select the events, then press Delete"). |
| Cmd+A | Select all rows. Escape: deselect all, or, if the selection is already empty, leave focus alone. |
| Cmd+D or Cmd+Shift+D | Duplicate selection. Matches the existing toolbar action; optional. |

The value-stepping change is the one real cost. Today plain Up/Down steps the value on a focused
cell. Under a grid model Up/Down must move rows, so stepping moves to Alt+Up/Down (or opens the
editor first and uses Up/Down there, which the time field already supports per segment). This is the
same trade-off every spreadsheet makes, and Logic makes it too: its arrows never change values.

### Edit layer (an editor is open in a cell)

| Key | Action |
| --- | --- |
| Enter | Commit and stay on the cell in the navigation layer (Cmd+Enter: commit as absolute for a multi-selection, already today). |
| Tab / Shift+Tab | Commit, move to the next / previous editable cell **and open it** (DP's "Tab... to move from field to field"). At the end of a row, Tab wraps to the first editable cell of the next row. |
| Escape | Cancel, stay on the cell. |
| Up / Down | Step the value in the editor (already today; the time field steps the segment under the caret). |
| Left / Right | Time field: move between segments (already today). Number field: caret movement as normal. |
| `.` `,` space | Time field: hop to the next segment (already today). |
| Blur by pointer | Commit (already today). |

Tab-to-open-next is the piece that turns the table into a keyboard editor: type a pitch, Tab, type
`3.2`, Tab, type a velocity, Enter. The time field needs no changes for this; its inner Left/Right
and separator hopping already work, and Tab leaving the field is a normal blur commit.

One subtlety: after a Start edit the list re-sorts. Logic keeps the selected event highlighted after
re-sort. Prelive should keep the current cell attached to the *note id*, not the row index, so Tab
after a Start edit moves to the Duration cell of the same note wherever it landed.

### Selection by pointer

- **Gutter:** replace the checkbox column with a clickable row-number gutter (Astryx
  `useTableRowIndex` already renders the index). Logic has no checkbox and uses the non-editable
  Status column as the click target; every other column in our table is a scrub field, so a
  non-editable gutter is needed for the same reason ("to avoid any unintentional parameter
  alterations"). If a visible affordance is wanted, keep the checkbox but make the whole gutter cell
  the hit target.
- **Click** selects that row only. **Shift-click** selects the range from the anchor. **Cmd-click**
  toggles a row. This is DP's model; Logic's "Shift adds without altering the previous selection" is
  less predictable and does not match what users expect from macOS lists.
- **Drag** in the gutter sweeps a range (pointer capture on the gutter, row under the pointer
  extends the range). This is Logic's "multiple selection by dragging" and is cheap once the gutter
  owns pointer events; the scrub hook's threshold logic in `useScrub` shows the click-vs-drag split.
- Header gutter: click for select all / deselect all (the existing select-all checkbox behaviour).
- Clicking a value cell focuses that cell and, since navigation is selection, selects its row if the
  row was not already part of the selection. Clicking a cell in an already-selected row keeps the
  multi-selection, so a relative multi-edit still starts by clicking any selected row's cell.

### Things from Logic that do not carry over

- Left/Right for previous/next event. Our list is vertical and Live has no track-selection use for
  Up/Down inside a Max device, so Up/Down is the right axis.
- The Select menu family (Same Pitch, Same Subposition, Highest Notes...). Useful later as context
  menu items; not part of navigation.
- Audition on selection (MIDI Out). Worth a separate look; it would need a LiveQL path to play a
  note, which does not exist today.
- Option-drag to override clamp limits. Prelive clamps per field in `clampField` and there is no
  requirement for it.

## 5. Implementation notes

- **State:** `current: { noteId, column } | null` in `NoteTable`, plus `anchorNoteId` for Shift
  ranges. Selection stays as `selectedKeys` in `NoteListEditor`; navigation writes to it.
- **Roving focus:** the cell whose coordinates match `current` gets `tabIndex={0}`, all others
  `-1`. Cells already render a focusable `span`; only the tabIndex rule changes. Focus is moved
  imperatively after a navigation keydown (a `ref` map keyed by `noteId:column`, or `querySelector`
  on `data-note-id`/`data-column` inside the table wrapper).
- **Key handling:** one `onKeyDown` on the table wrapper via `transformScrollWrapper` (or on each
  row through `transformBodyRow(props.htmlProps)`), guarded by "no editor open". Editors keep their
  own handlers and stop propagation for the keys they consume. Tab inside an editor calls a
  `onMoveNext(direction)` callback instead of letting the browser move focus.
- **Roles:** `transformScrollWrapper` sets `role="grid"` and drops Astryx's `tabIndex={0}` on the
  wrapper (otherwise it is an extra Tab stop); `transformBodyRow` adds `role="row"` and
  `aria-selected`; `transformBodyCell` adds `role="gridcell"`. The cells keep `role="spinbutton"`
  as the focusable widget inside the gridcell, which is the pattern ARIA describes for editable
  grids.
- **Gutter:** a plugin column ahead of Pitch using `useTableRowIndex`, with `onPointerDown`,
  `onPointerMove` (drag range) and click modifiers. `useTableSelection` can be dropped or kept for
  its select-all header cell.
- **Re-sort safety:** the table already keys rows by `note_id`; `current` and `anchor` are ids, so
  nothing else changes when Start edits reorder rows.
- **Delete:** the editor already has a delete-selected handler; wire Delete/Backspace on the wrapper
  to it when no editor is open.
- **Scrolling:** after moving `current`, call `scrollIntoView({ block: "nearest" })` on the cell so
  held-arrow navigation keeps the row visible (Logic: "Press and hold the respective arrow key to
  scroll through the list").

## 6. Decisions

Resolved 2026-09-04 and implemented the same day in `src/components/NoteTable.tsx` (grid layer,
gutter selection) and `src/components/BarBeatSixteenthInput.tsx` (shared `CellEditProps` contract);
the JSDoc on `NoteTable` and the two cell components is the key reference.

1. **Up/Down navigate rows; Alt+Up/Down step the value in place.** Shift+Alt+Up/Down for the fine
   step. Inside an open editor plain Up/Down still step, as today.
2. **Tab past the last editable cell of the last row adds a new note** and opens its first
   editable cell, so a run of notes can be entered without leaving the keyboard. The new note
   follows the add rule from the add/insert research (after the last row, inheriting length and
   velocity). Shift+Tab from the first cell of the first row just stops.
3. **No checkbox column.** Selection is shown by row highlight alone, as in Logic and DP. The
   row-number gutter is the pointer target for click, Shift-click, Cmd-click and drag selection;
   the header gutter cell toggles select all. `useTableSelection` is dropped.
4. **Audition on selection is out of scope** for this work.
