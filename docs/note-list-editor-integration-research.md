# Note List Editor Integration Research

Date: 2026-08-31

## Goal

Bring the extension-prelive note list editor (`refs/extension-prelive`) into this project's index
route, and untangle the page design while doing it. The DAW research behind that editor is
`refs/extension-prelive/docs/note-list-editor-research.md` (Cubase List Editor, Logic Event List,
DP Event List, Live idioms); its implementation is
`refs/extension-prelive/apps/ui/src/routes/index.tsx` (`ClipNotesSection`, `NoteNumberCell`).
Both projects use Astryx + `@astryxdesign/theme-neutral`, so the implementation translates
almost directly. Constraint: stay within Astryx defaults — component props first, `xstyle` +
tokens only when no prop covers it, no theme overrides.

Everything here is preliminary; the aim is a next iteration to look at and feel, not a final design.

---

## What the extension editor does (and why it's better than our `NoteTable`)

`refs/extension-prelive/apps/ui/src/routes/index.tsx`:

1. **Deferred-commit cells** (`NoteNumberCell`, :363-419). The in-progress value lives in the
   cell (`pending` state), not the row. Enter/blur commits, Esc reverts. Our `NoteTable`
   (`src/components/NoteTable.tsx:59-72`) pushes every keystroke straight into row state via
   `onChange` — no revert, and multi-edit would yank rows mid-typing.
2. **Display-vs-edit formatting** via `NumberInput` `formatValue`: unfocused shows `C3` /
   `1.2.3` (bar.beat.sixteenth), focused shows the raw number (:57, :86-99). Ours shows raw
   floats and MIDI numbers only.
3. **Draft vs baseline** (:425, :459): `draft === null` means "mirror Live"; edits create a
   draft; Discard drops it; Send is disabled until a draft exists.
4. **Row selection + multi-edit** (:475-493): `useTableSelection` checkboxes; one committed
   edit fans out to all selected rows. Relative (delta, clamped at rails) / Absolute
   (flatten) via `SegmentedControl` — the Cubase/Logic consensus semantics with an explicit
   toggle instead of a hidden modifier key.
5. **Musical sort** (:122-135): rows always sorted by start time then pitch; commit re-sorts;
   selection survives via stable row ids. Ours appends added notes at the end and never sorts.
6. **Hotkeys** (:522-532): `mod+a` select all, Delete/Backspace delete selected (skips typing
   targets — `useHotkeys` default). Delete-selected replaces our per-row ✕ `IconButton`.
7. **Toolbar owns the note actions** (:682-729): clip name + note count, multi-edit toggle,
   Add note, Delete selected, Discard, Send. Our page scatters these across the top toolbar
   and a footer text line.

## Where our data model is actually _stronger_ — don't import these parts

The extension bridge is poorer than liveql, and several of its workarounds are unnecessary here:

| Extension workaround                                                               | Why we don't need it                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client-generated `crypto.randomUUID()` row ids (:129)                              | Live gives us real `note_id`s (`src/lib/Domain.ts:49`). Use `note_id` as the row key (negative temp ids for adds, `src/routes/index.tsx:61`). Stable across re-sorts for free.                            |
| Assumed 4/4 in `positionLabel` (:74-91, "bridge does not expose the clip's meter") | We fetch `signature_numerator/denominator` per clip (`src/lib/liveql.ts:11`). Format positions with the clip's real meter.                                                                                |
| `velocity: number \| null` + clearable cell (:113-115, `isClearable`)              | liveql `Note.velocity` is always present (`Domain.ts:53`). No null case, no clear button.                                                                                                                 |
| Opaque `extras` carried through (:115)                                             | All 8 fields are concrete in our schema (`mute`, `probability`, `velocity_deviation`, `release_velocity`).                                                                                                |
| Full-replace `setClipNotes` (whole array per send)                                 | We have a **diff write**: `clip_add_new_notes` / `clip_apply_note_modifications` / `clip_remove_notes_by_id` (`src/lib/liveql.ts:152-190`). Preserves note identity in Live for untouched notes. Keep it. |

**Integration consequence for the diff write**: the extension's `commitField` only edits rows;
ours must also record `modifiedNoteIds` (as the current `onUpdate` does,
`src/routes/index.tsx:437-447`) and `deletedNoteIds` on delete-selected. The draft model and
the diff-tracking model compose cleanly: draft = rows + the two id-sets; Discard resets all
three; Send success re-reads and clears them (already the pattern in `writeMutation.onSuccess`,
`src/routes/index.tsx:141-155`).

One real difference to respect: extension multi-edit's relative velocity had to handle
"no explicit velocity" via `DEFAULT_VELOCITY` (:65, :158). Ours doesn't — `fieldOf` collapses
to plain field access.

## Current page inventory (`src/routes/index.tsx`) — keep / move / drop

| Piece                                                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell` + `TopNav` with clip name/path/length in `endContent` (:284-302)                   | Keep the shell. Move clip identity out of TopNav into the notes section header — TopNav `endContent` is the wrong home for the working clip (it's page chrome, not section state).                                                                                                                                                                                                                                                                                |
| Top toolbar: Read from Live / Preview Score / Write to Live / Add Note / Play Clip (:305-348) | **This is the mess.** It mixes three concerns: clip acquisition (Read), note editing (Write, Add Note), and audition (Play Clip, Preview Score). Split: acquisition stays top-level, editing actions move into the note-list toolbar (extension pattern), audition sits with the clip header.                                                                                                                                                                     |
| Navigator: tracks × slots grid of `ToggleButton`s in a `Card` (:366-433)                      | Keep the grid — it's this project's deliberate design (`docs/live-set-navigator-research.md`) and richer than the extension's `Selector` dropdown (shows the whole set, marks Live's selected clip with a check). Two tweaks: swap `Card` for `Section` (Astryx: dense data = edge-to-edge rows; Card = widgets/galleries/settings), and make it collapsible or `SegmentedControl`-switchable once the set gets wide — `maxSlots` columns × 112px overflows fast. |
| "Read from Live" (detail clip) (:311-317)                                                     | Keep — reading whatever's selected in Live is the fastest path and the navigator can't reach arrangement clips.                                                                                                                                                                                                                                                                                                                                                   |
| `NoteTable` (`src/components/NoteTable.tsx`)                                                  | Replace wholesale with the extension editor (ported `NoteNumberCell` + selection + multi-edit + hotkeys), keeping our diff tracking. Delete the ID column (debug leftover) — row number from `useTableRowIndex` if anything.                                                                                                                                                                                                                                      |
| Mute checkbox column                                                                          | Keep — it's already working and Live treats mute as first-class (`0` key in the piano roll). The extension only had it read-only in `extrasLabel`.                                                                                                                                                                                                                                                                                                                |
| probability / velocity_deviation / release_velocity                                           | Defer as editable columns (same call as the research doc); show as a secondary-text "More" column (`extrasLabel` pattern, :199-212) so the data is visible.                                                                                                                                                                                                                                                                                                       |
| Notes-count footer text (:457-462)                                                            | Fold into the note-list toolbar (`clipName · N notes · M modified · K deleted`).                                                                                                                                                                                                                                                                                                                                                                                  |
| Space = toggle play (:162-181)                                                                | Keep; consider migrating to `useHotkeys` alongside `mod+a`/Delete so all shortcuts live in one idiom. Watch interaction: Backspace-delete must not fire while a `NumberInput` is focused (`useHotkeys` skips typing targets by default; the hand-rolled Space handler already guards).                                                                                                                                                                            |
| Error `Banner` stack (:350-364)                                                               | Keep, but one banner slot per section (navigator errors by the navigator, write errors by the editor) reads better than four stacked at the top.                                                                                                                                                                                                                                                                                                                  |
| `ScoreDisplay` + `renderToken` + Preview Score button (:319-324, :464-466)                    | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Score

User intent: "I do want to see the score." Current flow is manual — Preview Score bumps
`renderToken`, `ScoreDisplay` posts notes to the LilyPond server fn
(`src/components/ScoreDisplay.tsx:29-32`, renderer `src/lib/lilypond/`, quantization per
`docs/score-quantization-research.md`).

Options:

1. **Manual button (status quo)** — cheap, but the score silently drifts from the table.
2. **Auto on read/write, manual during edits** — render on clip load and after a successful
   Send; keep a small Refresh in the score section for mid-edit checks. No render storms,
   score never stale relative to _Live's_ state, only relative to the draft.
3. **Debounced auto on every edit** — best feel, but LilyPond is a subprocess per render;
   typing in a cell would queue renders. Deferred-commit cells help (commits, not keystrokes)
   but multi-row nudging still fires bursts.

**Recommendation: option 2 now**; revisit 3 with a ~500ms debounce on committed edits once the
editor lands, since commits are much rarer than keystrokes. Mark the score stale
(`Text color="secondary"` badge or `StatusDot`) when `draft !== null` so the drift is visible.

## Proposed page structure

```
AppShell / TopNav ("prelive")
├─ Navigator            Section: toolbar (Refresh, "Read from Live" for detail clip)
│                       + tracks × slots Table (unchanged behavior)
├─ Clip editor          Section, only when a clip is loaded:
│  ├─ header            clip name · track · path · length · meter | Play Clip | Space hint (Kbd)
│  ├─ note toolbar      N notes · M modified | Relative/Absolute | Add | Delete sel | Discard | Write to Live
│  └─ note Table        # | Pitch | Start | Duration | Vel | Mute | More
│                       (selection checkboxes, deferred-commit cells, formatValue, musical sort)
└─ Score                Section: staleness indicator + Refresh; LilyPond SVG
```

Ordering question (open): navigator-above-editor matches the workflow (pick, then edit), but
once a clip is loaded the navigator is dead vertical space above the thing you're using.
Alternatives: collapse the navigator to a one-line summary after selection, or move it to a
`SideNav`/`LayoutPanel`. Start with collapse-after-selection — cheapest, no layout rework.

## Port plan (mechanical part)

1. `NoteNumberCell` → copy nearly verbatim; drop `isClearable`/null-velocity branch.
2. Field helpers (`fieldOf`/`clampField`/`withField`/`byMusicalOrder`) → copy; key rows by
   `note_id`; `positionLabel`/`lengthLabel` take `(beats, sigNum, sigDenom)` from `clipInfo`.
3. Replace `NoteTable.tsx` internals: columns Pitch/Start/Duration/Velocity get
   `NoteNumberCell` + `formatValue`; keep Mute checkbox; add "More" text column; add
   `useTableSelection` + `useTableRowIndex` plugins.
4. `commitField` in the route: extension logic + `modifiedNoteIds` bookkeeping (only for
   `note_id > 0`).
5. Toolbar rework per structure above; `useHotkeys` for mod+a / Delete.
6. Add-note default: extension's "continue the phrase" (:495-511 — next note starts where the
   last ends, inherits pitch/duration/velocity) beats our fixed C3-at-0 (`handleAddNote`,
   `src/routes/index.tsx:199-214`). Adopt.

Not in scope (matching the research doc's own deferrals): drag-to-scrub cells, composite
bar|beat|16th sub-fields, in-row velocity bars, audition-on-select (would need a liveql
note-preview mutation — none exists in `refs/liveql/liveql-n4m.js`), editable
probability/deviation/release columns.

## Implementation notes (2026-08-31)

Landed in `src/components/NoteTable.tsx` and `src/routes/index.tsx`. One deviation from the
port plan: our Astryx is **0.3.0** (extension used 0.5.0) and 0.3.0's `NumberInput` has no
`formatValue`, so the display-vs-edit split is a swap cell instead — a ghost `Button` showing
the formatted value (`C3`, `1.2.1`) that swaps to a `NumberInput` (`hasAutoFocus`, raw value)
on click; Enter/blur commits, Esc reverts. This is the DP model the extension research listed
as the component-level refinement. If Astryx is later bumped to ≥0.5.0, `NoteNumberCell` can
collapse back to a single always-rendered `NumberInput` + `formatValue`. Also: 0.3.0's `Table`
takes `plugins` as a `Record`, and `tsconfig` lib was bumped ES2022 → ES2023 for `toSorted`.

## Decisions (2026-08-31)

1. **Navigator**: keep the grid, collapse to a one-line summary after a clip is picked.
2. **Score render policy**: auto on clip read and after successful Write to Live; manual
   Refresh in the score section; staleness indicator while a draft exists.
3. **Layout artifact**: skipped — iterate directly in the app.
4. **Write granularity** (open, default assumed): explicit "Write to Live" kept — matches the
   draft model; auto-write per edit not planned.
