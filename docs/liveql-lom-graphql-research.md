# LiveQL + LOM + GraphQL Research

Date: 2026-03-23

---

## Architecture

```
┌─────────────────────┐     HTTP/GraphQL      ┌──────────────────────┐
│  prelive (React)    │ ───────────────────── │  liveql-n4m.js       │
│  TanStack Query     │  localhost:4000       │  GraphQL Yoga server │
│  Effect Schemas     │                       │  Node for Max        │
└─────────────────────┘                       └──────────┬───────────┘
                                                         │ Max IPC
                                                         │ get / set / call
                                                         ▼
                                              ┌──────────────────────┐
                                              │  liveql-m4l.js       │
                                              │  Max V8 / LiveAPI    │
                                              └──────────┬───────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────────┐
                                              │  Ableton Live        │
                                              │  Live Object Model   │
                                              └──────────────────────┘
```

**liveql** is a Max for Live device (`liveql.amxd`) with two JS layers:

- **Node for Max** (`liveql-n4m.js`): GraphQL Yoga server, port 4000 (configurable). Receives HTTP requests, translates to Max IPC actions.
- **Max V8** (`liveql-m4l.js`): LiveAPI bridge. Receives `get`/`set`/`call` JSON actions, executes against the LOM, returns results.

**Latency**: Every GraphQL round trip = HTTP → Node → Max IPC → LiveAPI → LOM → back. Note queries on clips with hundreds of notes may take noticeable time. Batch operations where possible.

---

## Live Object Model (LOM) — What It Is

The LOM is Ableton Live's internal object hierarchy exposed through the Live API. Every part of a Live Set is an object with:

- **Children** (nested objects)
- **Properties** (get/set/observe)
- **Functions** (actions like `fire`, `add_new_notes`)

Objects are identified by canonical paths (e.g. `live_set tracks 0 clip_slots 2 clip`) and runtime IDs (numeric, non-persistent across sessions).

### LOM Hierarchy (relevant slice)

```
Song (live_set)
├── is_playing, tempo, current_song_time, ...
├── view (Song.View)
│   ├── selected_track → Track
│   ├── detail_clip → Clip
│   └── highlighted_clip_slot → ClipSlot
├── tracks → [Track]
│   ├── name, arm, mute, solo, color, ...
│   ├── clip_slots → [ClipSlot]
│   │   ├── has_clip, is_playing, is_triggered, ...
│   │   ├── clip → Clip (or null)
│   │   │   ├── name, length, looping, is_midi_clip, ...
│   │   │   ├── fire(), stop()
│   │   │   ├── get_notes_extended(from_pitch, pitch_span, from_time, time_span)
│   │   │   ├── add_new_notes(notes_dictionary)
│   │   │   ├── apply_note_modifications(notes_dictionary)
│   │   │   ├── remove_notes_extended(from_pitch, pitch_span, from_time, time_span)
│   │   │   ├── remove_notes_by_id(ids...)
│   │   │   └── select_all_notes(), deselect_all_notes()
│   │   └── fire(), stop(), create_clip(length)
│   ├── devices → [Device]
│   └── mixer_device → MixerDevice (volume, panning, ...)
├── master_track → Track
├── return_tracks → [Track]
├── scenes → [Scene]
└── ...
```

**Notes are NOT first-class LOM objects.** They are data dictionaries returned by Clip functions. Live 11+ introduced the extended note API with richer fields.

---

## Note Data Model

Notes are dictionaries, not LOM objects. Live 11+ note fields:

| Field                | Type  | Range    | Notes                                                                               |
| -------------------- | ----- | -------- | ----------------------------------------------------------------------------------- |
| `note_id`            | int   | —        | Auto-assigned by Live. Used for `apply_note_modifications` and `remove_notes_by_id` |
| `pitch`              | int   | 0–127    | MIDI note number (60 = C3)                                                          |
| `start_time`         | float | beats    | Position in clip                                                                    |
| `duration`           | float | beats    | Length of note                                                                      |
| `velocity`           | float | 0–127    | Note-on velocity                                                                    |
| `mute`               | bool  | 0/1      | Whether note is deactivated                                                         |
| `probability`        | float | 0.0–1.0  | Chance note plays (Live 11+ MPE-era)                                                |
| `velocity_deviation` | float | -127–127 | Velocity randomization range                                                        |
| `release_velocity`   | float | 0–127    | Note-off velocity                                                                   |

**Not exposed**: MPE data (pitch bend, pressure, slide). The LOM note dictionary API does not include these.

---

## GraphQL Schema (liveql)

### Query — single root: `live_set`

Everything is traversed from `live_set`. One query fetches the entire object tree.

### Types

| Type       | Key Fields                                                                                                                                                          | Notes                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `Song`     | `id`, `path`, `is_playing`, `view`, `tracks`, `track(index)`                                                                                                        | Root object                  |
| `SongView` | `id`, `path`, `selected_track`, `detail_clip`                                                                                                                       | UI selection state           |
| `Track`    | `id`, `path`, `name`, `has_midi_input`, `clip_slots`, `clip_slot(index)`                                                                                            | Session tracks only          |
| `ClipSlot` | `id`, `path`, `has_clip`, `clip`                                                                                                                                    | Session grid cell            |
| `Clip`     | `id`, `path`, `name`, `length`, `looping`, `is_midi_clip`, `is_arrangement_clip`, `start_time`, `end_time`, `signature_numerator`, `signature_denominator`, `notes` | `notes` is a synthetic field |
| `Note`     | `note_id`, `pitch`, `start_time`, `duration`, `velocity`, `mute`, `probability`, `velocity_deviation`, `release_velocity`                                           | Data dict, not LOM object    |

### Mutations

| Mutation                           | Effect                               | LOM Call                              |
| ---------------------------------- | ------------------------------------ | ------------------------------------- |
| `song_start_playing`               | Start transport                      | `Song.start_playing()`                |
| `song_continue_playing`            | Continue transport                   | `Song.continue_playing()`             |
| `song_stop_playing`                | Stop transport                       | `Song.stop_playing()`                 |
| `clip_fire`                        | Launch clip                          | `Clip.fire()`                         |
| `clip_add_new_notes`               | Add notes to clip                    | `Clip.add_new_notes(dict)`            |
| `clip_apply_note_modifications`    | Modify existing notes (by `note_id`) | `Clip.apply_note_modifications(dict)` |
| `clip_remove_notes_extended`       | Remove notes by pitch/time range     | `Clip.remove_notes_extended(...)`     |
| `clip_remove_notes_by_id`          | Remove notes by ID                   | `Clip.remove_notes_by_id(ids...)`     |
| `clip_set_looping`                 | Toggle loop                          | `Clip.set("looping", ...)`            |
| `clip_set_properties`              | Set name/time sig                    | `Clip.set(...)`                       |
| `track_set_name`                   | Rename track                         | `Track.set("name", ...)`              |
| `clip_get_notes_extended`          | Query notes by region                | `Clip.get_notes_extended(...)`        |
| `clip_get_selected_notes_extended` | Query selected notes                 | `Clip.get_selected_notes_extended()`  |
| `clip_get_all_notes_extended`      | Query all notes (explicit mutation)  | `Clip.get_all_notes_extended()`       |
| `clip_select_all_notes`            | Select all notes                     | `Clip.select_all_notes()`             |

### Notable: `clip_get_notes_extended`, `clip_get_selected_notes_extended`, and `clip_get_all_notes_extended` are modeled as mutations (not queries) because they call LOM functions. They return `NotesDictionary`, not `Clip`.

---

## Key Workflows for the App

### 1. Read notes from a clip to display in a piano roll / note editor

Use the `notes` field on `Clip`:

```graphql
{
  live_set {
    track(index: 0) {
      clip_slot(index: 0) {
        clip {
          id
          name
          length
          is_midi_clip
          notes {
            note_id
            pitch
            start_time
            duration
            velocity
            mute
            probability
          }
        }
      }
    }
  }
}
```

- Resolves by calling `Clip.get_all_notes_extended()` (no args) — returns all notes regardless of loop boundaries
- Returns notes sorted by start_time, then pitch
- Only resolves for MIDI clips (`is_midi_clip` must be true); returns `null` for audio clips

### 2. Edit notes and write them back

**New notes** → `clip_add_new_notes`:

```graphql
mutation {
  clip_add_new_notes(
    id: 42
    notes_dictionary: {
      notes: [
        { pitch: 60, start_time: 0.0, duration: 1.0, velocity: 100 }
        { pitch: 64, start_time: 1.0, duration: 0.5, velocity: 80 }
      ]
    }
  ) {
    id
    notes {
      note_id
      pitch
      start_time
    }
  }
}
```

- `note_id` should NOT be provided (Live auto-assigns)
- Returns the full clip with all notes (re-fetched after mutation)

**Modify existing notes** → `clip_apply_note_modifications`:

```graphql
mutation {
  clip_apply_note_modifications(
    id: 42
    notes_dictionary: {
      notes: [
        {
          note_id: 14
          pitch: 62
          start_time: 0.0
          duration: 1.5
          velocity: 110
        }
      ]
    }
  ) {
    id
    notes {
      note_id
      pitch
      start_time
      duration
      velocity
    }
  }
}
```

- Must include `note_id` for notes being modified
- Can modify pitch, start_time, duration, velocity, mute, probability, etc.

**Typical edit workflow:**

1. Fetch clip with notes (`Clip.notes` or `clip_get_notes_extended`)
2. User edits notes in UI (move, resize, change velocity, add, delete)
3. Write back:
   - New notes → `clip_add_new_notes`
   - Modified notes → `clip_apply_note_modifications` (preserve `note_id`)
   - Deleted notes → `clip_remove_notes_by_id`
4. Invalidate query cache to refetch

**Important**: The `note_id` field is the key to modifying existing notes. The UI must track it. When adding new notes, omit `note_id` entirely.

### 3. Play / stop the song

```graphql
mutation {
  song_start_playing(id: 1) {
    is_playing
  }
}
mutation {
  song_continue_playing(id: 1) {
    is_playing
  }
}
mutation {
  song_stop_playing(id: 1) {
    is_playing
  }
}
```

- `id` is the `Song.id` (typically `1` for `live_set`, but should be obtained from a query)

### 4. Fire a clip

```graphql
mutation {
  clip_fire(id: 42) {
    id
    name
    is_playing
  }
}
```

### 5. Navigate the session grid

```graphql
{
  live_set {
    tracks {
      id
      name
      has_midi_input
      clip_slots {
        id
        has_clip
        clip {
          id
          name
          length
          is_midi_clip
          looping
        }
      }
    }
  }
}
```

- Full session grid in one query
- Filter by `has_midi_input` for MIDI tracks
- Filter by `has_clip` for occupied slots

---

## Gap Analysis — What liveql Doesn't Cover

| Missing                       | Impact                              | LOM Source                         |
| ----------------------------- | ----------------------------------- | ---------------------------------- |
| `Song.tempo`                  | Can't read/set BPM                  | `live_set tempo` (get/set/observe) |
| `Song.current_song_time`      | Can't show/set playhead position    | `live_set current_song_time`       |
| `Song.scenes`                 | Can't trigger scenes                | `live_set scenes`                  |
| `Song.master_track`           | Can't access master                 | `live_set master_track`            |
| `Song.return_tracks`          | Can't access returns                | `live_set return_tracks`           |
| `Track.arm`, `mute`, `solo`   | Can't toggle track state            | Track properties                   |
| `Track.devices`               | Can't see device chain              | Track child list                   |
| `Track.mixer_device`          | Can't control volume/pan            | Track child                        |
| `Track.arrangement_clips`     | Can't access arrangement clips      | Track child list (Live 11+)        |
| `Track.color`                 | Can't display track colors          | Track property                     |
| `ClipSlot.fire`, `stop`       | Can't fire empty slots or stop      | ClipSlot functions                 |
| `ClipSlot.create_clip`        | Can't create clips programmatically | ClipSlot function                  |
| `Clip.is_playing`             | Can't show playback state per clip  | Clip property (observe)            |
| `Clip.loop_start`, `loop_end` | Can't control loop boundaries       | Clip properties                    |
| `Clip.color`                  | Can't display clip colors           | Clip property                      |
| `Clip.quantize`               | Can't quantize notes                | Clip function                      |
| `Clip.duplicate_loop`         | Can't duplicate loop                | Clip function                      |

### Critical for a note editor

- **`tempo`**: Needed to convert between beats and time for display.
- **`current_song_time`**: Needed to show playhead position in the editor.
- **`Clip.is_playing`**: Needed to show which clip is currently playing.

---

## Practical Considerations

### Object ID Stability

- LiveAPI `id`s are runtime-only. They change between sessions, reloads, and Live restarts.
- Never persist IDs. Always use them as transient handles within a session.
- For "which clip am I editing?", use `SongView.detail_clip` as the entry point.

### Clip Selection Strategy

The simplest way for a user to select a clip for editing:

1. User clicks a clip in Ableton's Detail View
2. App queries `live_set { view { detail_clip { id name notes { ... } } } }`
3. App opens the note editor for that clip

This avoids needing complex navigation UI — Ableton itself is the clip selector.

### Mutation Response Pattern

All mutations in liveql return the refreshed object (e.g., `clip_add_new_notes` returns the `Clip` with updated notes). This is convenient but means every mutation re-fetches data from the LOM. For note editing, a single edit triggers a full clip re-read including all notes. Batch edits should be coalesced.

### GraphQL Query Cost

- `Clip.notes` on a clip with 1000 notes = `get_all_notes_extended` → all 1000 notes round-tripped through Max IPC
- Consider: initial load fetches all notes, subsequent edits use `clip_apply_note_modifications` (sends only changed notes, returns full clip)

### Boolean Coercion

- LOM uses `0`/`1` for booleans. GraphQL Yoga coerces to `false`/`true` on output.
- Mutation inputs arrive as JS booleans; the server converts back to `0`/`1` before sending to LiveAPI.

### Max for Live Requirements

- User must have Ableton Live (Standard or Suite) with Max for Live installed
- The `liveql.amxd` device must be loaded on a track in the Live Set
- The Node script inside the device must be started (click the start button on the device)
- Live must be running with a Set open

---

## Recommended Schema Extensions (for future liveql PRs)

Priority order for note editor use case:

1. **`tempo`** on Song — display timing context
2. **`current_song_time`** on Song — playhead tracking
3. **`is_playing`** on Clip — playback state indicator
4. **`loop_start`**, **`loop_end`** on Clip — loop boundary editing
5. **`quantize`** on Clip — note quantization
6. **`color`** on Track and Clip — visual differentiation

---

## Summary

**liveql gives us a solid foundation for a note editor.** The current schema covers the core workflow: navigate to a clip, read its notes, add/modify/remove notes, fire clips, control transport. `Clip.notes` returns all notes via `get_all_notes_extended`, including notes in loop iterations.

**The main app architecture** should be: TanStack Query manages caching and invalidation of GraphQL queries. The user selects a clip in Ableton (via `detail_clip`), the app fetches its notes, renders a piano roll, and writes mutations back through liveql. Effect Schemas validate all wire data.
