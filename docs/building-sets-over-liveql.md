# Building Live Sets over LiveQL

What we learned building `projects/Melodic House Project` by sending GraphQL to LiveQL on
`http://localhost:5100/graphql`, and what comes next. Measured on Live 12.4.6 unless marked otherwise.

## Projects

- Every project lives in `projects/<Name> Project/<Name>.als`, the layout Live itself writes when it saves a Set.
- `vp run project:new "<Name>"` copies `projects/Seed Project/Seed.als`, opens the copy in Live, and waits until
  LiveQL's `live_set.file_path` names it.
- The Seed holds one MIDI track, `LiveQL`, carrying `../ableton-m4l-liveql/liveql.amxd`. Track 0 is always that
  track. Everything else finds its tracks by name.
- Git ignores each project's `Backup/` and Finder `Icon\r`. Git also drops the empty `Ableton Project Info/`
  folder, so `project:new` creates it again.
- Core Library samples are referenced from the Live app bundle, not copied, which keeps a `.als` small (Melodic
  House is 60 KB).

## What LiveQL cannot do, and why

- The LOM has no automation envelopes, no Browser and no save. Neither the docs in `m4l-docs/apiref/lom/` nor
  Live's runtime `info` lists them. They belong to Live's Python Remote Script API, which Max for Live cannot
  reach. These are not LiveQL gaps. The schema covers every documented class except `ControlSurface`, which is
  left out on purpose.
- `track_insert_device` takes only built-in devices by their UI name. It cannot insert a Max for Live device, so
  LiveQL can't put itself into a new Set. That is why the Seed exists.
- Untested idea for automation: turn on `song.session_automation_record`, fire the clip, and step
  `device_parameter_set` values while it plays.

## Driving Live outside LiveQL

- Accessibility is on. JXA can click Live's menus:
  `Application("System Events").processes.byName("Live").menuBars[0].menuBarItems.byName("File").menus[0].menuItems.byName("Save Live Set").click()`
  saves the Set.
- Switching Sets while the current one has unsaved changes brings up a save prompt. LiveQL's `test/live/open.js`
  clicks Don't Save by position, but for projects we care about, a person answers it.

## LiveQL behavior worth knowing

- Aliased mutations in one document run in order, so one request can do several steps.
- Every create returns ids in its readback (new track, clip slots, devices, chains), so a script can chain steps
  without searching.
- Parameter ids differ on every device, even two Drifts. Read `parameters { id name min max }` and set by name.
  Values are mostly 0–1 knob positions, not units. `display_value` is untested.
- Volume and sends are `DeviceParameter`s under `track.mixer_device` (`volume`, `sends`).
- `song_set(tempo)` sets the tempo.
- Live adds the letter prefix to a return track's name itself: setting `Space` reads back `A-Space`.
- `track_insert_device` drops an unknown name without an error. Check the returned `devices`.

## Building a Drum Rack

1. `track_insert_device(device_name: "Drum Rack")`.
2. `rack_device_insert_chain` adds a `DrumChain`. It defaults to `in_note: 36`.
3. `chain_set` sets the chain's `name`. `drum_chain_set` sets its `in_note`. They are different mutations.
4. `chain_insert_device(device_name: "Simpler")`.
5. `simpler_device_replace_sample(file_path:)` loads a file, including into an empty Simpler.

Core Library one-shots live under
`/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/One Shots/Drums/`
(`Kick/`, `Clap/`, `Hihat/` and so on).

## Melodic House, as built

122 BPM, A minor, one 4-bar Session clip per track, with chords Am, F, C, G a bar each.

| Track            | Device                                                                                | Notes                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bass             | Drift (LP Freq 0.42, LP Res 0.25, Env 1 Decay 0.3, Sustain 0.35)                      | Offbeat eighths on the roots, MIDI 45, 41, 48, 43                                             |
| Drums            | Drum Rack: Kick 909 1 (36), Clap 909 (39), Hihat Closed 909 (42), Hihat Open 909 (46) | Kick every beat, clap on 2 and 4, open hat on offbeats, soft closed hats on the 16ths between |
| Pad              | Drift (Attack 0.55, Release 0.6, Sustain 0.85, LP Freq 0.55, Volume 0.4)              | Am7, Fmaj7, C, G held a bar each in close voicing                                             |
| Arp              | Drift (Decay 0.28, Sustain 0, LP Freq 0.62, Volume 0.38)                              | 16ths through the chord tones an octave up, order 0 1 2 3 2 1 0 2                             |
| A-Space (return) | Delay, Reverb                                                                         | Sends: Pad 0.45, Arp 0.55, Drums 0.08                                                         |

## Next

1. An Effect CLI under `scripts/` that builds a Set from a song spec: tempo, tracks by name, instrument and
   parameters by name, clips with notes per scene. Rerunning it converges on the spec. New operations go in
   `src/web/server/liveql/liveSet.graphql`, then `vp run liveql:codegen`.
2. Pure note generators: chord progression in a key, arp, offbeat bass, step strings for drums.
3. Scenes (intro, breakdown, drop), then `track_duplicate_clip_to_arrangement` into the Arrangement.
4. Try the automation-recording idea for filter sweeps.
