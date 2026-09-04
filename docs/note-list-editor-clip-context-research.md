# Note List Editor Clip Context Research

Date: 2026-09-03

Research question: what does Live expose about a clip and its Set, beyond the notes themselves, that
would help the note list editor display start times, durations, and pitches well? Where does that
information live today (LiveQL, the LOM, or nowhere), and what would LiveQL need to add?

Sources: `refs/liveql-schema.graphql` (the LiveQL SDL), `refs/m4l-docs/apiref/lom/` (LOM reference
for Live 12.3.5), `refs/live-manual/en/live-manual/12/` (chapters 3.13, 8.2.2, 8.2.4, 10.6), and
Prelive's `src/lib/LiveSet.ts`, `src/routes/index.tsx`, `src/components/NoteTable.tsx`.

## Summary

- Time signature: already available and already used. LiveQL exposes `signature_numerator` and
  `signature_denominator` on both `Clip` and `Song`. Prelive fetches the clip pair and formats
  positions as bar.beat.sixteenth with it. Nothing to add server-side.
- Scale: per-clip `root_note`, `scale_name`, `scale_mode`, and `scale_intervals` were added to
  the Max for Live API's `Clip` class in Live 12.4.15b1 (beta, released 2026-09-02). The installed
  Live is 12.4.5, and the LOM reference mirrored in `refs/m4l-docs` (12.3.5) predates the change,
  so neither LiveQL nor Prelive has them yet. Until Live 12.4.15 ships, the only scale data is the
  `Song` mirror of the Control Bar, which reflects the selected clip and is not acceptable for an
  editor that must handle any clip. Plan: add the four fields to LiveQL's `Clip` type and
  `ClipPropertiesInput` as soon as a 12.4.15 build is on the machine.
- Grid: `Clip.view.grid_quantization` and `grid_is_triplet` are exposed and fetched, but the editor
  deliberately does not follow them (see Decisions).

## What Live Provides

### Time signature

| Source | LOM members                                                        | In LiveQL                                | In Prelive                                                                                                          |
| ------ | ------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Clip   | `signature_numerator`, `signature_denominator` (get, set, observe) | Yes, on `Clip` and `ClipPropertiesInput` | Fetched in `ClipFields`; used by `positionLabel`, `lengthLabel`, the Duplicate dialog, and `requiredPlaybackRegion` |
| Song   | `signature_numerator`, `signature_denominator`                     | Yes, on `Song` and `SongPropertiesInput` | Not fetched                                                                                                         |
| Scene  | `tempo`, `time_signature_*`, `*_enabled`                           | Yes                                      | Not fetched                                                                                                         |

Manual 8.2.2: the clip time signature is display-only, independent of the Set's, and is what the
MIDI Note Editor's ruler uses. So the clip pair is the correct one for the note list, and the Song
pair is only relevant for an "arrangement position" column on arrangement clips. Arrangement time
signature changes (manual 6.5) are not exposed by the LOM at all; only the current Song value is.

Existing formatting in `NoteTable.tsx` derives quarters-per-bar as `numerator * 4 / denominator`
and quarters-per-beat as `4 / denominator`. This is right for simple meters (4/4, 3/4, 7/8 shown as
seven eighth-note beats). It matches Live's ruler, which also counts the denominator unit as the
beat rather than grouping 6/8 into two dotted beats.

### Scale

Verified 2026-09-03 against four sources:

1. `refs/m4l-docs/apiref/lom/clip/index.md` (LOM reference for Live 12.3.5): no scale members on
   `Clip`. An exhaustive grep of `refs/m4l-docs` for `root_note|scale_name|scale_mode|scale_intervals`
   hits only `song/index.md`.
2. The live Cycling '74 LOM page for Clip (docs.cycling74.com/apiref/lom/clip/): no scale members.
3. Ableton's Live 12 release notes: 12.0.5 added `Song.scale_mode`; nothing on Clip through 12.4.5.
4. Ableton's Live 12 beta release notes, entry 12.4.15b1 dated September 2, 2026, under "New
   Features and Improvements":

   > The following Clip properties are now available in the Max for Live API: root_note,
   > scale_name, scale_mode, scale_intervals

The installed Live is 12.4.5 (checked via `Info.plist` and via LiveQL's `live_app`
`get_version_string`). So today the LOM `Clip` has no scale, and after upgrading to 12.4.15 it will.

LOM `Song` (since Live 12.0):

- `root_note` int, 0 = C through 11 = B.
- `scale_name` unicode, "as displayed in the Current Scale Name chooser".
- `scale_intervals` list of ints, semitone offsets from the root (Major is `0 2 4 5 7 9 11`).
- `scale_mode` bool.

These mirror the Control Bar. Manual 3.13 and the Control Bar overview say the Control Bar
reflects the currently selected clip, and edits write to that clip or to clips created afterwards.
So the Song fields answer "what is the scale of the clip Live has selected" and nothing else. They
are not a per-clip source and Prelive should not build on them, since the editor must display and
edit any clip regardless of Live's selection.

Consequences for Prelive:

- Before Live 12.4.15: no scale display. The Song proxy is rejected because it is only correct for
  the selected clip.
- After Live 12.4.15: extend LiveQL. Add `root_note`, `scale_name`, `scale_mode`, and
  `scale_intervals` to `Clip` (the same `get` list pattern `getClip` already uses, with
  `scale_intervals` in the multi-value list like `Song.scale_intervals`), and the first three to
  `ClipPropertiesInput` so the editor can set a clip's scale. Regenerate `refs/liveql-schema.graphql`
  and add the fields to `ClipFields` in `src/lib/LiveSet.ts` and `Domain.Clip`. Access mode
  (get/set/observe) is not stated in the release note; assume get/set like the Song fields and
  confirm against the 12.4.15 LOM reference when it is published.
- Expect the four properties to also be present on audio clips (manual 8.2.4 says audio clips carry
  scale settings for downstream devices), so no null handling should be needed beyond what
  `Clip.signature_*` gets.

Related but not exposed anywhere: the note spelling preference (flats, sharps, both, auto, MIDI
numbers) from the piano ruler context menu, the Highlight Scales toggle, Fold to Notes, and Fold to
Scale. These are UI state without LOM access.

### Grid

`Clip.View.grid_quantization` (0 = Off, 1 = 8 Bars down to 9 = 1/32) and `grid_is_triplet` are
in LiveQL and in `ClipFields`, but nothing in the editor reads them. They tell the editor what
resolution the user is working at in Live, which is useful for scrub step size, for rounding
displayed sixteenths, and for deciding how many decimals a position label needs.

### Region and playback

Already fetched: `length`, `looping`, `loop_start`, `loop_end`, `start_marker`, `end_marker`,
`position`, `start_time`, `end_time`, `is_arrangement_clip`. Not fetched: `playing_position`,
`is_playing`, `has_groove`, `velocity_amount`.

- `playing_position` is in beats of clip time and would drive a playhead marker in the list. It
  needs polling since LiveQL has no subscriptions.
- `has_groove` matters because groove shifts the audible timing away from the stored start times
  the editor shows. A small "groove applied" badge would explain apparent timing mismatches.
- `velocity_amount` (Velocity slider in launch settings) affects heard velocity, not the note's
  velocity value.

### Pitch naming beyond note names

- Drum tracks: the LOM path is `Track.devices` → `RackDevice.drum_pads` (128 pads) →
  `DrumPad.name` and `DrumPad.note`. LiveQL exposes none of the device tree. This is the one
  display feature that needs a LiveQL change, and it is a large one (Device, RackDevice, DrumPad
  types plus a way to find the first Drum Rack on a track).
- Tuning system: `Song.tuning_system` (`name`, `pseudo_octave_in_cents`, `note_tunings`) exists
  in the LOM but not in LiveQL. Only matters for non-12-TET Sets; out of scope.
- Octave convention: Prelive's `noteName` maps 60 to C3, which matches Live's display.

## Display Ideas Ranked

No LiveQL change, possible now:

1. Show whether a note lies outside the playback region (before `start_marker` or loop start,
   after `end_marker` or loop end) since those notes are silent. All inputs are already fetched.
2. Poll `Clip.playing_position` and `is_playing` while the clip plays to highlight the current row.
3. Fetch `has_groove` and show a badge.

After Live 12.4.15 and the LiveQL clip-scale change:

4. Show root and scale name in the clip toolbar when `scale_mode` is on. Mark pitches outside
   `scale_intervals` in the pitch cell (dimmed or a small marker) and show the scale degree next
   to the note name for in-scale pitches.
5. Spell accidentals from the root note: flats for roots on the flat side of the circle of fifths
   (F, Bb, Eb, Ab, Db, Gb), sharps otherwise. This is what Live's "Auto" spelling does. Without a
   scale keep sharps.

## Decisions (2026-09-03)

- Drum tracks and pad names are out of scope.
- The position column stays fixed bar.beat.sixteenth. Live's grid setting is transient UI state
  and the editor does not follow it.
- No seconds column.
- The editor is agnostic to whether a clip is an arrangement or session clip. Every note field it
  shows is in clip-relative beats and means the same thing in both cases.

## Scale Scope, Stated Plainly

A scale is a property of each clip, not of the Set. Two clips in the same Set, in the same track,
in Session or Arrangement, can carry different root notes and scale names, and either can have
Scale Mode off. There is no document-wide scale. What looks global is the Control Bar chooser,
which the manual (3.13, Control Bar overview) describes as a mirror: it shows the scale of the
currently selected clip, and editing it writes to that clip (or to clips created afterwards when
nothing is selected). The one global piece is the Highlight Scales toggle, which is a view option,
not a scale.

So "which scale applies" is decided by which clip you are looking at, not by where the playhead is
or which view is open. The LOM only exposes the mirror (the Song fields), which is why Prelive can
read the scale of the selected clip and no other.

## Arrangement Versus Session Clips

Both kinds are the same `Clip` class in the LOM with the same note API, markers, loop, and time
signature. The differences that touch the editor:

- `start_time` and `end_time` mean different things. For an arrangement clip they are the clip's
  edges in song time. For a session clip `start_time` is when it was last launched and can be
  negative. The editor does not use either; the playback region comes from markers and loop.
- Notes are always stored in clip-relative beats, where 0 is the clip's bar 1.1.1. An arrangement
  clip at bar 33 still has its first note near 0. So bar.beat.sixteenth labels are identical for
  both kinds, which is what makes the editor agnostic.
- Session clips can be fired and loop indefinitely; arrangement clips play at their arrangement
  position. Only the Play Clip button cares, and it already works through `clip_fire`.
- Scale and time signature are per clip in both views.

This is now recorded as a JSDoc on `Domain.Clip` in `src/lib/Domain.ts` so it does not need to be
re-derived.

## Open Questions

- Is scale-aware editing wanted (pitch scrub in scale degrees, snap to scale), or display only?
