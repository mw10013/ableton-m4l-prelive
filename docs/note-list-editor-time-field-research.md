# Note List Editor Time Field Research

Research question: the Start and Duration columns show three dot-separated numbers. What are they, how
should a user edit them, can `ScrubbableNumberInput` help, and how do we get a denser table without
fighting Astryx?

## Conclusions

1. The three numbers are Live's **bars . beats . sixteenths**. Start is a 1-based position
   (`1.1.1` is the first sixteenth of the clip). Duration is a 0-based span (`0.0.2` is two
   sixteenths). The underlying LOM value is a single float in quarter-note beats; the label is derived
   from it plus the clip time signature.
2. Today's edit path exposes that raw float in a `NumberInput` (click `1.2.1`, see `1` or `1.25`).
   That leaks the storage unit, and the mental arithmetic from `3.4.3` to `11.5` beats is the exact
   thing the label exists to hide.
3. Recommendation: a dedicated `BarBeatSixteenthInput` (name TBD) that keeps beats as the value, renders
   three segments at rest, scrubs **the segment under the pointer** in that segment's unit (Logic's
   per-unit drag), and on click opens one text field that accepts Live's typing conventions
   (`3.2.2`, `3`, `3.2`, `.`/`,` to hop segments, Enter/Esc). The scrub engine in
   `ScrubbableNumberInput` is reusable but must be lifted out of that component into a hook first,
   because Astryx `NumberInput` is `type="number"` and cannot display formatted text.
4. Density: the 36 px rows come from the sm `Button`/`NumberInput` (28 px) inside compact cell padding.
   Rendering rest-state cells as `Text` instead of `Button` gets rows to about 28 px with zero overrides.
   The sanctioned next step is a denser type scale through `defineTheme` (Astryx documents a
   "dense/functional" 12 px base), not per-cell `xstyle`.

## What The Three Numbers Are

`src/components/NoteTable.tsx` (`positionLabel`, `lengthLabel`):

```ts
quartersPerBar  = numerator * 4 / denominator
quartersPerBeat = 4 / denominator
bar       = floor(beats / quartersPerBar)
beat      = floor(rem / quartersPerBeat)
sixteenth = (rem - beat * quartersPerBeat) * 4      // may be fractional
```

- Position label adds 1 to every segment; length label does not. This matches Live: positions are
  1-based (`1. 1. 1`), the Loop Length field shows a delta (`1. 0. 0` = one bar in the screenshot).
- The "sixteenth" segment is always a sixteenth note regardless of meter. In 6/8 a beat is an eighth,
  so `beat` runs 1..6 and sixteenth runs 1..2.
- Sub-sixteenth remainders render as a decimal on the last segment. A note at 0.125 beats shows as
  `1.1.1.5`, which is visually indistinguishable from Cubase's four-segment `bar.beat.16th.tick`
  format. Duration 1/128 (the `MIN_DURATION`) shows as `0.0.031`. This is a display bug to fix in the
  same pass, whatever editor is chosen (see "Sub-sixteenth values" below).

### Live's own fields

Live manual, Arrangement View:

> "The Arrangement Position fields show the play position in bars-beats-sixteenths. When one of the
> fields is selected, the value can be adjusted using a few different methods: Use the mouse to adjust
> the value by dragging up or down. Type a number and then press Enter. Use the up and down arrow keys."

"Fields", plural, and "when one of the fields is selected": Live treats bar, beat, and sixteenth as
three sub-fields. The keyboard shortcut table (41.6 Adjusting Values) confirms:

| Action | Key |
| --- | --- |
| Decrement/Increment | up / down |
| Fine adjustment | Shift + up / down |
| Finer resolution when dragging | Shift |
| Return to default | Delete |
| Type in value | 0…9 |
| **Go to next field (Bar/Beat/16th)** | `.` `,` |
| Cancel / confirm | Esc / Enter |

Clip View 8.2.1 explains the screenshot: Start/End are two absolute positions; Loop uses Position
(absolute) plus Length (a span). The Set buttons capture the playhead, quantized to global
quantization. Live has no per-note numeric position field at all; notes are edited on the grid, and
note length is set with a Duration chooser plus Set Length button. So for the note list we are
borrowing Live's clip-field idiom, not copying a Live note-list UI.

### Other DAWs (refs)

- **Logic Event List** is the closest precedent and the only manual that documents dragging an
  individual unit: "Drag the specific position unit vertically." Format is `bar beat division tick`,
  all 1-based. Typing is left-anchored: "you can enter the bar number only, and press Return", and
  "units can be separated by either spaces, dots, or commas". Editing Start re-sorts the list and keeps
  the selection.
- **Cubase List Editor** shows `bar.beat.16th.tick` (120 ticks per sixteenth by default) following the
  ruler format. Double-click to type is primary; End and Length are both editable and mutually derived.
- **Digital Performer** shows `measure|beat|tick` at 480 PPQ. Double-click or Option-click opens a text
  box that accepts typing or vertical drag. Tab and arrows move between fields. Chord notes share one
  printed start time, separated by rules.
- None of the four manuals describes a fractional last segment. Live's fields have three integer
  segments; Cubase/Logic/DP resolve finer than a sixteenth with a fourth integer (ticks).

## Current Implementation Audit

`NoteNumberCell` in `src/components/NoteTable.tsx`: rest state is a ghost `Button` with the label;
edit state swaps in an Astryx `NumberInput` bound to raw beats with `step: 0.25`, Enter/blur commit,
Esc cancels. Group edits go through `commitField` in `NoteListEditor.tsx`, relative by default, with
`clampField` (start ≥ 0, duration ≥ 1/128).

`ScrubbableNumberInput` (home page prototype) wraps `NumberInput` and adds the pointer gesture. Its
engine (anchor-based displacement, 8 px per step, Shift ×4, overshoot re-anchoring, Escape cancel,
commit on release, wheel with idle-commit, optional pointer lock) is exactly what the segments need,
but two facts block direct reuse:

- `NumberInput` is `type="number"` and its source says "With type="number", we can't use formatted
  display values". No `formatValue`/`parseValue` exists. It cannot show `3.2.1`.
- The gesture is one value with one step. A segment scrub needs a step chosen by the segment under
  the pointer (bar, beat, sixteenth).

Astryx has no segmented value editor. `TimeInput`/`DateInput` are single native inputs. `InputGroup`
joins adjacent controls visually. `TextInput` supports `size="sm"`, `onKeyDown`, and `xstyle`.

## Approaches

### A. Keep one number, fix the label leak

Edit state stays a `NumberInput`, but the value shown is beats with the bar.beat.sixteenth label kept
visible beside it (or in the tooltip), and the scrub engine is dropped in as-is.

- Pro: smallest change; `ScrubbableNumberInput` slots in today.
- Con: user still types and reads quarter-note floats. The 1-based/0-based conversion is done in the
  head. Nobody's DAW works this way.

### B. Three independent `ScrubbableNumberInput`s in an `InputGroup`

Bar, beat, sixteenth as three integer inputs, each scrubbable. Commit recomposes beats.

- Pro: entirely Astryx components; each segment has native arrow stepping and its own step.
- Con: three focusable 28 px controls per cell, times two columns, kills density and tab order.
  Carry (beat 4 + 1 in 4/4 → bar +1, beat 1) must be simulated across inputs and reads oddly during a
  drag when a sibling field changes. Sub-sixteenth remainders have nowhere to live.

### C. Single text field with a bar.beat.sixteenth parser (Live-style typing)

Rest state: text. Click: one `TextInput` prefilled with `3.2.1`, all selected. Typing rules follow
Live/Logic: `.`, `,` or space separate segments; missing trailing segments default to 1 (position) or
0 (length); `3` means bar 3 beat 1 sixteenth 1; Enter commits, Esc cancels; up/down step the segment
that contains the caret. Whole-field vertical drag scrubs sixteenths (or the grid step).

- Pro: one focusable control per cell, matches how Live users type, trivial parser, tabular layout
  survives.
- Con: scrub is single-unit unless combined with D. Moving a note by bars means many pixels or a typed
  value.

### D. Segment-aware scrub on the rest-state label (Logic-style drag)

Rest state renders three `Text` spans (`3`, `2`, `1`) with the separators. Pointer down on a span
plus vertical movement scrubs that segment's unit: bar = `quartersPerBar`, beat = `quartersPerBeat`,
sixteenth = 0.25 beats. The value is still one float, so carry is automatic and the display re-derives.
Shift gives the finer step (a sixteenth on any segment, or the clip grid, or 1/128 on the last
segment). A press without movement falls through to C's text field.

- Pro: the Logic gesture users of event lists already know; one control per cell; the underlying beats
  float never changes representation, so `commitField`'s relative group edit keeps working unchanged
  (a bar step on note A applies the same beat delta to selected notes B and C).
- Con: needs the scrub engine extracted from `ScrubbableNumberInput` into a hook that takes
  `{ value, step, onChange, onCommit }` and works on any element. Sub-sixteenth remainders must be
  preserved, not truncated, while scrubbing coarser segments.

### E. Popover editor

Click opens a small popover with three labelled `NumberInput`s (bar, beat, sixteenth) plus the raw
beats value, like Live's clip Start/End block.

- Pro: room for labels and both units at once; Astryx-native.
- Con: two clicks and a modal state for the most common edit; poor for scanning and for quick
  successive edits down a column. Better suited to a Duplicate-dialog-style destination field than to
  a table cell.

## Recommendation

**C + D as one component.** Rest state is three tabular-number text segments; segment drag scrubs in
that segment's unit; a click opens a single text field with Live's typing conventions. This is the
union of Live (typing, `.`/`,` hop, Shift fine, Enter/Esc) and Logic (per-unit drag), and it keeps
one focusable element per cell.

Contract:

- Props: `label`, `value` (beats), `kind: "position" | "length"`, `numerator`, `denominator`,
  `min`, `onChange`, `onCommit`, optional `fineStep` (default 0.25; can later read
  `Clip.View.grid_quantization`).
- Steps by segment: bar `quartersPerBar`, beat `quartersPerBeat`, sixteenth `0.25`. Shift on any
  segment drops to `fineStep`, and on the sixteenth segment to `MIN_DURATION` (1/128), which is how a
  user reaches an un-gridded value without typing a float.
- Scrub adds `steps * step` to the raw beats, so fractional remainders survive coarse drags.
- Arrow keys in the text field step the segment containing the caret; `.` `,` and space move the caret
  to the next segment (Live) and are also accepted as separators when parsing (Logic).
- Parser: `^\s*(\d+)(?:[.,\s]+(\d+))?(?:[.,\s]+(\d+(?:\.\d+)?))?\s*$`. Missing segments default to
  1/1 for positions, 0/0 for lengths. Segment overflow is allowed and carried (`1.5.1` in 4/4 is
  `2.1.1`), as Logic does ("continues until it is carried over").
- Clamping stays in `clampField`; the component clamps only to `min` for display.
- Group edits: unchanged. `onCommit(beats)` flows into `commitField`, relative mode applies the delta.
- Escape in either mode restores the pre-gesture value and never commits.

Implementation shape:

1. Extract the gesture from `ScrubbableNumberInput` into `useScrub({ value, step, min, max, onChange,
   onCommit, pointerLock })` returning pointer handlers and an `isScrubbing` flag. Re-wrap
   `ScrubbableNumberInput` on top of it so the home-page prototype stays green.
2. New component in `src/components/`, composed of Astryx `Text` (rest) and `TextInput` (edit). The
   segment spans need `xstyle` for `cursor: ns-resize` and `user-select: none`; that is a sanctioned
   `xstyle` use (Astryx docs: "Every component accepts an xstyle prop for style customization").
3. Replace the Start and Duration `numberColumn`s. Pitch and Velocity can move to the same rest-as-text
   pattern with `useScrub` for consistency and density.

### Sub-sixteenth values

Fix the ambiguous decimal regardless of editor choice. Options: (a) round the display to the nearest
sixteenth and mark inexact values with a trailing `+` or a dimmed dot, with the exact beats in the
tooltip and in the text field; (b) show a fourth tick segment like Cubase (`1.1.1.60` at 120 ticks per
sixteenth). Live users never see ticks, so (a) is the better fit; the text field shows the exact
decimal sixteenth (`1.1.1.5`) only while editing, where the context makes it unambiguous.

## Density

Measured from Astryx source (`Table/TableCell.tsx`, `Button.tsx`, `NumberInput.tsx`, tokens):

| Layer | Value |
| --- | --- |
| Compact cell padding | 4 px block, 8 px inline |
| Text line height (body 14 px) | 20 px |
| sm Button / NumberInput / TextInput height | 28 px |
| Current row (sm Button in compact cell) | ≈ 36 px |
| Row with `Text` rest state | ≈ 28 px |
| Supporting text (12 px, 20 px leading) | same row, smaller glyphs |

Findings:

- Table `density` changes padding only; font size is always `--text-body-size`. There is no
  `min-height` on rows or cells, so row height is content plus padding.
- `renderCell` output is placed in the `<td>` unwrapped, so a `Text` rest state gives the 28 px row for
  free. The 36 px today is entirely the ghost `Button`.
- No virtualization; pagination is the built-in answer for very long clips. Not needed for typical
  note counts but worth knowing.
- Per-cell `xstyle` in data-driven mode requires a plugin (`transformBodyCell` pushes into
  `props.xstyle`) or switching to children mode with `<TableRow>/<TableCell>`.

Relaxation ladder, least invasive first:

1. Rest cells as `Text` with `hasTabularNumbers` (and `type="supporting"` for 12 px). Zero overrides.
   Do this first; it likely lands at the DAW-like density in the screenshots.
2. Column widths: Start and Duration at `pixel(112)` are generous for `12.4.3`; `pixel(80)` fits.
3. App-wide dense scale via `defineTheme({ typography: { scale: { base: 12, ratio: 1.125 } } })`
   and token overrides for `--size-element-sm` and spacing. Astryx's own comment names this the
   "Dense/functional" preset, so it is configuration, not an override, and it keeps every component
   consistent. It changes the whole app, which for a DAW-adjacent tool is probably right.
4. A row-level `xstyle` plugin to trim `paddingBlock` to `--spacing-0-5` (2 px) on this table only.
   Still tokens, still `xstyle`, but the first table-specific override; hold until 1 to 3 prove
   insufficient.

Digital Performer's trick of printing the start time only on the first note of a chord is a further
vertical and visual density win that fits the sorted-by-start table; note it for later.

## Decisions (2026-09-03)

- Shift-fine scrub uses a fixed sixteenth on bar and beat segments and 1/128 on the sixteenth segment.
  It does not follow Live's grid setting, consistent with the display decision in the clip context doc.
- Off-grid values are displayed rounded to the nearest sixteenth with a small dimmed marker; the exact
  value appears in the tooltip and in the text field while editing. No silent rounding, no tick segment.
- Dense settings are applied to the note editor only at first, so the current and dense looks can be
  compared before any app-wide theme change.
- Keep a single Duration column. Live gives no ruling for notes (region uses Start/End, loop uses
  Position/Length, notes have no numeric fields); the loop block's Length is the closer match. Revisit a
  derived End column only if "stop at a position" edits prove common.

## Open Questions

1. Pointer lock default for segment scrubs: the prototype's open decision applies unchanged.

## Sources

- `refs/live-manual/en/live-manual/12/arrangement-view/index.md` (Arrangement Position fields)
- `refs/live-manual/en/live-manual/12/live-keyboard-shortcuts/index.md` (41.6 Adjusting Values)
- `refs/live-manual/en/live-manual/12/clip-view/index.md` (8.2.1 Clip and Loop Region Settings)
- `refs/logic-manual/guide/logicpro/change-the-position-and-length-of-events-lgcp215888c6/12.3_/mac/15.md`
- `refs/logic-manual/guide/logicpro/change-event-values-lgcp215851db/12.3_/mac/15.md`
- `refs/cubase-manual/operation-manual/midi-editors.md` (List Editor), `project-window.md` (ruler format)
- `refs/performer-manual/SIRA/Digital_Performer_Help/pages/event_list.md`, `event_info.md`
- `refs/astryx/packages/core/src/Table/TableCell.tsx`, `Table/BaseTable.tsx`, `NumberInput/NumberInput.tsx`,
  `TextInput/TextInput.tsx`, `theme/tokens.stylex.ts`; `refs/astryx/packages/themes/neutral/src/neutralTheme.ts`
- Event List Anatomy artifact (DAW screenshots):
  https://claude.ai/code/artifact/9f6a2caf-afee-4aca-8a81-719870295cab
- `src/components/NoteTable.tsx`, `src/components/ScrubbableNumberInput.tsx`, `src/components/NoteListEditor.tsx`
