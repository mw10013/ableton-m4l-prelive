# LiveQL Composite Mutations: Inventory, and Moving the Orchestration Into Prelive

Date: 2026-09-03. Status: implemented in prelive (`src/lib/LiveSet.ts`, `replaceNotes`).
The matching LiveQL cleanup is specified in
`../ableton-m4l-liveql/docs/lom-mirror-cleanup-handoff.md`.

## Question

LiveQL is meant to be a thin mirror of the Live Object Model (LOM) over GraphQL, not a place for
higher-level functions that combine LOM calls. Which LiveQL operations break that rule, does prelive
depend on them, and what does prelive look like when it calls the LOM-shaped operations directly?

## Two terms, in plain words

**Markers / region.** A clip has a start and an end that Live plays between. For a looping clip
they are `loop_start` and `loop_end`; for a non-looping clip they are `start_marker` and
`end_marker`. Prelive touches them for one reason: if a note in the editor lands past the end of
the clip, the clip has to be made longer first or Live hides the note. "Set markers" means
"write the new start and end".

**Marker ordering.** When both start and end change in one save, the order of the two writes
matters. Live refuses a start set past the current end, and an end set before the current start,
silently, no error, the old value stays. So when the region grows, write the end first, then the
start. When it shrinks, write the start first, then the end. That is the entire rule.

## Where the aggregation lives

The Max layer (`liveql-m4l.js`) is already pure LOM: three handlers, `get`, `set`, `call`, each
one `LiveAPI` operation. Every composite is in the Node layer (`liveql-n4m.js`). Removing
composites touches only that file, its tests, and its docs.

## Inventory

| Operation                       | Extra LOM calls hidden inside                                          | Prelive used it | Verdict                                 |
| ------------------------------- | ---------------------------------------------------------------------- | --------------- | --------------------------------------- |
| `clip_replace_notes`            | get, get_all_notes_extended, remove_notes_extended, add_new_notes, get | yes (save)      | composite; replaced in prelive          |
| `clip_write_notes`              | set×n, add, get_notes_by_id, apply, remove, get                        | no              | composite; dead since commit `9d9ca71`  |
| `clip_set_properties`           | get + ordered set×n                                                    | yes (region)    | ordering logic; moved to prelive        |
| other `*_set_properties`        | set×n                                                                  | no              | plain batching, one set per key         |
| `clip_apply_note_modifications` | get_notes_by_id pre-check + apply                                      | no              | validation read; remove for consistency |
| `getApplication`                | four parallel reads                                                    | n/a             | query fan-out, not a mutation; keep     |

Details:

- `clip_replace_notes` (`liveql-n4m.js:1350`): preflight non-MIDI check, snapshot, delete by a
  window derived from the snapshot, add, readback. Error names the step. Not atomic.
- `clip_write_notes` (`:1304`): properties, add, modify, remove. Zero references in prelive.
- `clip_set_properties` (`setClipProperties`, `:963`; `clipPropertyOrder`, `:945`): reads the clip
  first and orders marker writes so no intermediate state has start past end.
- `clip_apply_note_modifications` (`applyNoteModifications`, `:1034`): `get_notes_by_id` first so
  a stale id fails loudly instead of Live silently ignoring the whole list.

## Why not "delete by the ids the editor holds"

The LOM has no delete-all. It has `remove_notes_by_id` and `remove_notes_extended` (a pitch
range and a time range). Deleting by ids the editor loaded earlier is fragile: any note Live
gained since the load survives and the clip is out of sync with the editor. The safe shape is to
read fresh at save time and delete by what was just read.

## What prelive does now

`LiveSet.replaceNotes` in `src/lib/LiveSet.ts`, four phases, each phase one LOM call per field:

1. **Fresh read** via `readClipById`: current markers decide the write order, current notes
   decide the deletion window. A missing clip fails here before anything changes.
2. **Markers**, one `clip_set_properties` per property, ordered by the rule above. Skipped when
   the region is unchanged.
3. **`clip_remove_notes_extended`** over pitch 0..127 and time from the earliest onset just read
   through one beat past the latest. The window comes from a read because Live can keep a note at
   a negative `start_time`, which a fixed `0..N` window would miss. Skipped when the clip is empty.
4. **`clip_add_new_notes`** with the full editor list. Every note gets a new `note_id`. Skipped when
   the list is empty.

Phases 2 to 4 are sent as **one GraphQL document with aliased mutation fields**, and the last
field selects the whole clip, which is the readback. A mutation document cannot contain a query
root field, but every mutation returns the object, so no separate read is needed. The GraphQL
spec requires mutation root fields to execute serially in document order, and graphql-js/yoga
honor that, so the readback reflects every earlier step and the whole write is one round trip
after the fresh read, without any composite on the server. If nothing needs writing (region
unchanged, clip empty, list empty) the fresh read is returned as is. On a failure graphql-js
nulls that field and reports `errors[].path` naming the alias, so the failing step is still
identifiable. Prelive's `gqlDecode` treats any error as failure of the whole save, and the editor
recovers by reloading, never by retrying, as before.

Verified against a running Live on 2026-09-03:

- Document validation: `clip_add_new_notes` returns `ClipNotesPayload`, so its selection is
  `{ note_ids }`, not `{ id }`. Caught by the server, fixed.
- A document with an invalid id returned four errors, one per alias, with `path` set, and
  `data` with each alias null. Serial execution and per-step reporting confirmed.
- Round trip on the open clip: remove_notes_extended then add_new_notes with the same four notes,
  the clip selected on the add field. Notes came back identical with new ids, and the readback
  already showed the new ids.

Round trips per save: 2 HTTP requests (read, then mutate with readback), the same as before, and
the same LOM calls as before minus the non-MIDI preflight, which the editor already guards.

## What was lost, and why it is fine

- Non-MIDI preflight: the editor only opens on MIDI clips.
- One combined "step X failed" error string: replaced by GraphQL error paths.
- LiveQL's marker ordering: one comparison, now in prelive, documented on `replaceNotes`.
- Strict `ReplacementNoteInput` on the server: prelive's `Domain.ReplacementNote` is already
  strict, so the client sends complete notes; only the server-side enforcement goes.

## Decisions taken

- Everything that can move to prelive moves. LiveQL keeps no composite mutations.
- Whole-clip replace is delete-then-add. Note ids change on every save; MPE and per-note identity
  are out of scope for now.
- Per-property marker writes rather than one `clip_set_properties` with two keys, so prelive no
  longer relies on server-side ordering and keeps working after the LiveQL cleanup.
