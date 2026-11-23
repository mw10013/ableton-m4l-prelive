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
- Automation is recorded instead of written: `lq sweep` moves a parameter while Live records. See
  [Recording automation](#recording-automation).

## Driving Live outside LiveQL

- Accessibility is on. JXA clicks Live's menus (`lq menu "File>Save Live Set"`, `lq save`).
- Switching Sets while the current one has unsaved changes brings up a save prompt. LiveQL's `test/live/open.js`
  clicks Don't Save by position, but for projects we care about, a person answers it.
- Live's browser search loads anything it finds onto the selected track, plug-ins included: select the track with
  `song_view_set(selected_track:)`, then Cmd-F, type the name, Down, Return. `lq load <track> <name>` does that.
- macOS credits the agent's shell to T3 Code (Nightly), which has Accessibility and Screen Recording. Capture
  still fails inside Claude Code's Bash sandbox (`could not create image from display`); run `lq shot` and the
  other screen commands with the sandbox off.
- `lq shot [window]` saves a PNG of one window scaled to points, so its pixel coordinates are what `lq click`
  takes. `lq keys` types with `cliclick`, one character per command, because Omnisphere drops fast typing.
- `lq ax` reads Live's Accessibility tree: every labeled control in a window and its value, about 280 lines for the
  main window (`lq ax tree "" -f volume` filters). `ax press` and `ax set` act on a control by label. It runs a
  small Swift helper (`scripts/lq/ax.swift`, compiled on first use into `node_modules/.cache/lq/`) that takes 0.4 s
  where JXA through System Events takes 15 s. Plug-in editors draw their own UI, so Omnisphere shows only its
  window buttons; it needs `shot`.
- With Live in the background (screen awake): `ax tree` of the main window, `shot` of any window, Omnisphere's
  included, and LiveQL all work without bringing Live forward. Plug-in windows drop out of the Accessibility tree,
  and `click` and `keys` bring Live forward, because macOS sends input to the front app.
- While the screen is locked or asleep, Live cannot come forward and its tree shrinks to one stub window named
  `Live`. LiveQL keeps working.
- `shot --crop x,y,w,h` keeps part of a window, which costs fewer tokens to look at.
- Bringing Live forward moves focus off a plug-in window, so the screen commands only activate Live when it is not
  already in front.

## Listening

- The agent cannot hear Live. Its checks are structural: note counts, clips in the right slots, readback values.
- The master track has no `mute` (it reads null), but its volume is a parameter: `lq master 0` silences Live while
  the agent works, `lq master 0.85` is back to 0 dB.

## LiveQL behavior worth knowing

- Aliased mutations in one document run in order, so one request can do several steps.
- Every create returns ids in its readback (new track, clip slots, devices, chains), so a script can chain steps
  without searching.
- Parameter ids differ on every device, even two Drifts. Read `parameters { id name min max }` and set by name.
  Values are mostly 0–1 knob positions, not units. `str_for_value(value:)` turns one into Live's text with units
  (`1.10 kHz`, `63.6 ms`, `-26.6 dB`), so `lq tweak` prints both.
- Volume and sends are `DeviceParameter`s under `track.mixer_device` (`volume`, `sends`).
- `song_set(tempo)` sets the tempo.
- Live adds the letter prefix to a return track's name itself: setting `Space` reads back `A-Space`.
- `track_insert_device` drops an unknown name without an error. Check the returned `devices`.

- `track_duplicate_clip_to_arrangement` copies a Session clip into the Arrangement. Session clips override the
  Arrangement until `song_set(back_to_arranger: false)`.

## Plug-ins: Omnisphere

- `track_insert_device` cannot insert plug-ins. The browser-search keystrokes above can.
- Live loaded Omnisphere as an `AuPluginDevice` and opened its editor. `plugin_device_set(is_editor_open: false)`
  closes it.
- The LOM sees almost nothing: `presets` is `["Default"]` and `parameters` is `Device On` plus whatever Live has
  configured. Omnisphere keeps its patches in its own library.
- In the patch browser, a lit GLIDE button on the main page means notes slide in pitch (portamento). Clicking it
  off changes the copy in the Set only.
- The screen does the rest. `lq editor Omni` opens the editor (it may open on the About page; click the
  Spectrasonics logo for the main page). In the patch browser, the search box is at about 165,125 and the first
  result at 130,511: `lq click Omnisphere/Omni 165 125`, `lq keys "warm pad" return`, `lq click Omnisphere/Omni 130
  511`, then `lq shot omni` to read the loaded patch. The patch is stored in the Live Set; nothing is saved into
  Omnisphere.
- Untested: Live's `-_PluginAutoPopulateThreshold` option in `Options.txt` would expose more parameters to LiveQL.

## Recording automation

The LOM cannot write Arrangement automation, but Live records parameter moves made through it.
`lq sweep Arp "LP Freq" 0.15 0.58 17-25 --curve 2 --before 0.58`:

1. Sets the parameter to `--before`, puts `start_time` one bar before the ramp, turns on `record_mode` and plays.
   `start_playing` begins at `start_time`, not at `current_song_time`.
2. Polls `current_song_time` and sets the parameter along the ramp. One poll and one write take about 0.1 s, so an
   8-bar ramp at 122 BPM gets about 166 points.
3. Sets the end value, stops, turns off `record_mode` and puts `start_time` back to 0.

What we learned:

- Recording writes the parameter's current value where it starts, and automation holds its first point back to
  bar 1. A sweep that starts recording with the wrong value muffles everything before it. Setting `--before` first
  avoids that, and recording a constant over a range (`sweep ... 0.58 0.58 1-17`) repairs it.
- Nothing can read an Arrangement envelope back, but playing the section and reading `device_parameter.value`
  shows the recorded curve: it matched the ramp to three decimals. `automation_state` 1 means automated.
- Recording runs in real time: the 8-bar sweep takes 18 s, with the master silenced (`lq master 0`).
- Setting an automated parameter while stopped overrides its automation until `re_enable_automation`.

## Listening by measurement

The agent cannot hear, but it can export audio and measure it with `ffmpeg` (Homebrew).

Exporting, as done by hand with `lq`:

1. `lq menu "File>Export Audio/Video..."`. The dialog is readable with `lq ax tree export`: rendered track, start,
   length, normalize, sample rate, file type.
2. The range is whatever the dialog last held, not the loop. Click the Render Start or Render Length field and type
   bars (`lq click export 212 96`, `lq keys 17 return`).
3. The Rendered Track popup: click it (`215,73`), then `arrow-down` and Return. Clicking a menu item did not take.
   **All Individual Tracks** renders one file per track plus the mix, which made the analysis possible.
4. `lq ax press export Export` opens the Save panel; the press reports error -25204 because the panel blocks, but it
   works. Cmd-Shift-G, the folder path, then Return through System Events (`key code 36`): the Go To sheet ignores
   cliclick's Return. Wait for each sheet before typing, or the text lands in the name field.

Live ignores `ax set` on its controls: the call succeeds and nothing changes. `ax` reads and presses; typing sets.

Measuring:

- Loudness and true peak per section: `ffmpeg -i f.aif -af atrim=a:b,ebur128=peak=true -f null -`, with
  a and b from bars (a bar is 240/BPM seconds).
- `showspectrumpic` draws a spectrogram PNG the agent can read like a screenshot. Section changes show clearly.
- Spectral centroid misleads on gappy parts: near-silent frames pull it up. The level above a high-pass works better.

What the first export of Melodic House found:

| Stem  | Drop LUFS | Drop peak | Finding                                         |
| ----- | --------- | --------- | ----------------------------------------------- |
| Omni  | −11.8     | +0.1      | Loudest part, and the clipping (261 samples)    |
| Drums | −17.7     | −3.3      |                                                 |
| Pad   | −18.4     | −7.1      |                                                 |
| Bass  | −30.0     | −12.6     | About 13 LU under the drums; nearly inaudible   |
| Arp   | −33.6     | −15.1     | Quiet                                           |
| Mix   | −9.9      | +0.7      | Intro −20.8, Groove −14.8, Breakdown −16.2 LUFS |

The Arp sweep did not show in the audio: its level above 1 kHz stayed flat across the Breakdown. Drift's `LP Mod
Amt 1` is 0.968, so each note's envelope opens the filter far above the base `LP Freq`, which is what the sweep moved
(56 Hz to 1.1 kHz). Sweep a knob that dominates the sound, or lower the envelope amount first.

## Building a Drum Rack

1. `track_insert_device(device_name: "Drum Rack")`.
2. `rack_device_insert_chain` adds a `DrumChain`. It defaults to `in_note: 36`.
3. `chain_set` sets the chain's `name`. `drum_chain_set` sets its `in_note`. They are different mutations.
4. `chain_insert_device(device_name: "Simpler")`.
5. `simpler_device_replace_sample(file_path:)` loads a file, including into an empty Simpler.

Core Library one-shots live under
`/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/One Shots/Drums/`
(`Kick/`, `Clap/`, `Hihat/` and so on).

## The `lq` CLI

`vpx scripts/lq/lq.ts <command>` (`--help` lists them). Its operations are in `scripts/lq/lq.graphql`, generated
with `vp run liveql:codegen`. Tracks are named or numbered, and `Space` finds `A-Space`.

| Command                                                                         | Does                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `show`                                                                          | The whole Set, one line per track: volume, sends, devices, clips by slot |
| `track <name> -d Drift k=v...`                                                  | Makes sure a MIDI track exists with that device, then sets parameters    |
| `params <track> [-d dev] [-f text]`                                             | A device's parameters as `name=value [min..max]` or `{items}`            |
| `tweak <track> "LP Freq=0.4"...`                                                | Sets parameters by name and prints the result with units                 |
| `mix <track> vol=0.7 pan=0 A=0.4`                                               | Volume, pan and sends by letter                                          |
| `clip <track> <slot> <lane>... [-l beats -g grid --gate -v vel -n name --fire]` | Replaces a slot's clip                                                   |
| `scene <i> [-n name] [--fire]`                                                  | Names or fires a scene, creating scenes up to its index                  |
| `arrange Intro:2 Drop:4`                                                        | Rebuilds the Arrangement from scenes. Rerunning converges                |
| `tempo`, `master`, `play`, `stop`, `save`                                       | `save` clicks File > Save Live Set                                       |
| `gql '<document>'`                                                              | The escape hatch                                                         |
| `load <track> <name>`                                                           | Loads the browser's first match onto a track, plug-ins included          |
| `editor <track> [--close]`                                                      | Opens or closes a plug-in's editor                                       |
| `windows`, `shot [window] [-o png]`                                             | Lists Live's windows; captures one at one pixel per point                |
| `click <window> x y [--double]`, `keys cmd+f text return`, `menu "File>Save"`   | Drives Live and plug-in windows. `""` as the window is the Set           |
| `ax tree <window> [-f text]`, `ax press <window> <label>`, `ax set ... <value>` | Live's controls as text, and acting on them by label                     |
| `sweep <track> <param> <from> <to> <bars> [--curve --before]`                   | Experimental: records a parameter ramp into the Arrangement              |

Lanes (`scripts/lq/notation.ts`): sequence tokens are a note (`A1`, Ableton octaves with C3 = 60), a chord
(`Am7@2`, `C@3^1` for the first inversion), `+` to stack, `.` rest, `-` hold, and a `!` or `?` suffix for an
accent or a soft step. A step lane is `C1:x..oX.-.` (hit, rest, soft, accent, hold). A lane repeats to the clip length.

## Melodic House, as built

122 BPM, A minor, chords Am, F, C, G a bar each. Scenes: 0 Groove, 1 Intro, 2 Breakdown, 3 Drop. The Arrangement
is `arrange Intro:2 Groove:2 Breakdown:2 Drop:4`, 40 bars. The Omni track holds Omnisphere on Giant Trance Lead 1
with GLIDE off, playing a lead in the Drop. The Arp's LP Freq is automated: 0.58 through bar 16, a slow rise from
0.15 across the Breakdown (bars 17–24), 0.58 in the Drop. Slot 0 is the first sketch:

| Track            | Device                                                                                | Notes                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bass             | Drift (LP Freq 0.42, LP Res 0.25, Env 1 Decay 0.3, Sustain 0.35)                      | Offbeat eighths on the roots, MIDI 45, 41, 48, 43                                             |
| Drums            | Drum Rack: Kick 909 1 (36), Clap 909 (39), Hihat Closed 909 (42), Hihat Open 909 (46) | Kick every beat, clap on 2 and 4, open hat on offbeats, soft closed hats on the 16ths between |
| Pad              | Drift (Attack 0.55, Release 0.6, Sustain 0.85, LP Freq 0.55, Volume 0.4)              | Am7, Fmaj7, C, G held a bar each in close voicing                                             |
| Arp              | Drift (Decay 0.28, Sustain 0, LP Freq 0.62, Volume 0.38)                              | 16ths through the chord tones an octave up, order 0 1 2 3 2 1 0 2                             |
| A-Space (return) | Delay, Reverb                                                                         | Sends: Pad 0.45, Arp 0.55, Drums 0.08                                                         |

## Next

1. A song spec file that `lq` applies whole, so a Set rebuilds from one file.
2. Generators over the notation: chord progressions in a key, arps from chords.
3. Several ramps in one recording pass, since each pass runs in real time. Clip envelopes are no way around it:
   creating them and inserting steps is Python-only, like Arrangement envelopes.
4. Record the master to a file and measure levels, so the agent can catch clipping and silent tracks.
