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
  `song_view_set(selected_track:)`, then Cmd-F, type the name, Down, Return. `lq load <track> <name> [--replace]`
  does that. It checks the selection took (Live sometimes ignores the first `selected_track`, and the browser loads
  onto whatever is selected) and closes plug-in editors before and after, since an editor in front takes the keys.
  Loading an instrument onto a track that has one replaces it, settings and all.
- macOS credits the agent's shell to T3 Code (Nightly), which has Accessibility and Screen Recording. Capture
  still fails inside Claude Code's Bash sandbox (`could not create image from display`); run `lq shot` and the
  other screen commands with the sandbox off.
- `lq shot [window]` saves a PNG of one window scaled to points, so its pixel coordinates are what `lq click`
  takes (`cliclick`).
- Keys need two routes. `lq keys` sends shortcuts (`cmd+f`) and text through System Events, where a modifier is
  part of the keystroke. cliclick's separate key-down and key-up once left Cmd held, so the letters of "Omnisphere"
  became Cmd-O, Cmd-N and Cmd-S: Live saved, then opened a new Set. Bare key names (`return`, `arrow-down`,
  `page-up`) go through cliclick in one call, because Live's own UI ignores System Events key codes and misses keys
  sent in separate cliclick calls. macOS's own sheets (the Save panel's Go To) are the reverse: `keys --native`.
  `--paced` types one character at a time for Omnisphere.
- Live's popup menus wrap around with the arrow keys, ignore typed names and ignore clicks on items. Page Up goes to
  the first item.
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
- The screen commands bring Live forward only when it is not in front, and they ask System Events which app is
  in front: asking Live itself (`Application("Live").frontmost()`) moves keyboard focus off a plug-in window.

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
- `lq omni <track> [-c category] [-p patch] [--list] [--glide off]` picks patches by mouse and reads the browser
  with Apple Vision (`ax ocr`): it clicks a category and a patch by name, prints a category's patches with
  `--list`, and confirms the load by reading the patch name back. `--glide` reads the GLIDE button's color from one
  pixel and clicks it only if needed. The patch is stored in the Live Set; nothing is saved into Omnisphere. A
  first open may land on the About page; click the Spectrasonics logo for the main page.
- Measured, the parts of Omnisphere's editor that take input:
  - Mouse clicks work in every instance.
  - The search box at times takes no focus in any instance, whatever the click (single, double, slow, on the
    magnifier), while Live reports the editor as its focused window. Typing then reaches Live, where Space plays.
    `-s/--search` types only when a pixel inside the box is white (focused) and still stops Live if typing started
    playback.
  - The scroll wheel moves the lists in some instances and nothing in others, with the editor frontmost under the
    pointer. `omni` pages by clicking the scrollbar track instead, measured from a column of pixels.
- OCR: `ax ocr` runs Apple Vision on a capture as it is, with no thresholding, about 0.2 s a read. It needs the
  accurate level: the fast level garbles Omnisphere's light-on-dark text. Language correction stays off, since
  it turns real patch names into words (Szignature to Signature, Seq to Seg). Over Synth Short's 336 patches,
  Vision misread two: `Cllcky` for Clicky and a Cyrillic `МОРНО` for MOPHO. `readText` maps Cyrillic lookalikes
  to Latin, and `textKey` matches names with i, l and 1, and o and 0, folded together. Tesseract, the earlier
  reader, needed a brightness threshold per text color and read one patch twice, with two kinds of apostrophe.
- Listing Synth Short's 336 patches takes about 40 s; loading a patch takes 6 to 8 s from the top of a list and
  up to 30 s from deep in it.
- Untested: Live's `-_PluginAutoPopulateThreshold` option in `Options.txt` would expose more parameters to LiveQL.

## Recording automation

The LOM cannot write Arrangement automation, but Live records parameter moves made through it.
`lq sweep Arp Frequency 0.15 0.62 25-41 -d "Auto Filter" --curve 3 --before 0.58`:

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
- Arrangement Record also records every armed track, over its clips. A stray keystroke had armed Drums, so a sweep
  replaced bar 16 of the drums with an empty recording and cut the Drop's first downbeat. `sweep` now refuses to run
  while any track is armed (`arm` or `implicit_arm`). A MIDI track that `lq track` creates comes armed, so
  disarm it (`track_set(properties: [{ arm: false }])`) before a sweep.
- Nothing clears an Arrangement envelope, so moving sections means recording over the old automation: a constant
  where the old ramp was, then the new ramp. One `--curve 3` ramp over 16 bars stays low through a Breakdown and
  opens fast in the Build.

## Listening by measurement

The agent cannot hear, but it can export audio and measure it with `ffmpeg` (Homebrew).

`lq export <dir> [-n name] [--stems] [--start 1] [--bars n]` drives File > Export Audio/Video: it sets the
rendered track, the range (default: bar 1 through the last Arrangement clip) and turns off the analysis file, checks
the dialog with `ax` before pressing Export, then answers the Save panel. **All Individual Tracks** (`--stems`)
renders one file per track plus the mix. The master fader is part of the render, so put it at 0 dB first; Live
renders offline and plays nothing. The dialog's quirks, all handled by `export`:

- The range is whatever the dialog last held, not the loop. Typing into the Render Start and Render Length fields
  sets it; `ax set` succeeds and changes nothing.
- The Rendered Track popup takes Page Up and arrows (see the popup notes above).
- `ax press export Export` reports error -25204 because the Save panel blocks it, but it goes through.
- Wait for each sheet before typing, or the text lands in the name field.

`lq levels <files...> -s Intro:1-9 -s Drop:25-41` prints integrated loudness (LUFS) and true peak (dBFS) per file
and section, using the Set's tempo for bar times.

Measuring:

- `levels` runs `ffmpeg -i f.aif -af atrim=a:b,ebur128=peak=true -f null -`, with a and b from bars (a bar is
  240/BPM seconds).
- `showspectrumpic` draws a spectrogram PNG the agent can read like a screenshot. Section changes show clearly.
- Spectral centroid misleads on gappy parts: near-silent frames pull it up. The level above a high-pass works better.

What the first export of Melodic House (Drift instruments) found:

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

After the move to Omnisphere every synth came in 5 to 8 LU over the drums and the mix clipped in every section.
Faders set in decibels (`lq mix Bass vol=-8db`) against the drums as the anchor, and a Limiter on Main (True Peak,
ceiling −1 dB), gave:

| Stem  | Drop LUFS | Fader    | Role                                       |
| ----- | --------- | -------- | ------------------------------------------ |
| Drums | −17.7     | 0 dB     | Anchor                                     |
| Bass  | −18.3     | −8 dB    | With the kick                              |
| Omni  | −18.9     | −11 dB   | Lead, level with the bass                  |
| Pad   | −22.0     | −8.5 dB  | Bed                                        |
| Arp   | −23.1     | −13.5 dB | Under the pad                              |
| Mix   | −12.5     | peak −1  | Intro −17.2, Groove −14.3, Breakdown −19.1 |

The Arp's sweep moved to an Auto Filter after Omnisphere, whose `Env Amount` is bipolar (0.5 is off, 0 is −100%).
Its energy above 1 kHz now drops about 14 dB at the start of the Breakdown and opens back up into the Drop.

## Song spec

`projects/<Name> Project/song.json` describes the Set: tempo, scenes, the Arrangement as `Scene:repeats`, each track's
devices, mix (volume in decibels) and Session clips in lane notation. `patch` records a plug-in's patch for people,
since Live cannot read it; `dump` keeps it.

- `lq dump song.json` writes the spec from Live. It turns notes back into lanes (`toLanes` in `notation.ts`): one
  lane when the notes fit, otherwise one lane per pitch, a step lane where every hit is one step long. A token's
  `*96` suffix sets an exact velocity, and a lane can be `{ "lane": ..., "gate": 0.5 }` when it needs its own grid,
  gate or base velocity. It warns about Arrangement clips the spec cannot express.
- `lq apply song.json [--dry-run]` changes only what differs: tempo, scene names, missing tracks and native devices,
  mix, clips whose notes, name or length differ, and the Arrangement when any clip changed or it differs from the
  spec clip by clip. A missing plug-in is reported for `lq load`. A second run reports `in sync`.

Measured on Melodic House: `dump` takes 1.7 s and writes 275 lines for 13 clips. After changing the tempo, a fader, a
scene name, the lead's notes and deleting a clip, `apply` restored all of it in 14 s, the next run was `in sync`, and a
fresh dump matched the spec byte for byte. Its first run found the armed-Drums damage above and rebuilt the
Arrangement; the Arp's automation, which lives on the track, came through every rebuild.

Not covered: device parameters, a Drum Rack's chains and samples, plug-in patches and automation.

## Sidechain pumping

A Compressor's sidechain is routable over LiveQL: `compressor_device_set` takes `input_routing_type` (a track) and
then `input_routing_channel`, whose list appears only after the type is set. A Drum Rack source lists every chain's
Pre FX, Post FX and Post Mixer taps, so `Drum Rack | Kick | Pre FX` ducks on the kick alone, whatever the clap and
hats do and wherever the Drums fader sits. `S/C On` is an ordinary parameter.

`lq sidechain Pad Drums -c "Kick | Pre FX"` does all three. Melodic House runs Peak, Threshold −24 dB, Ratio
10:1 (Arp 6.7:1), Attack 0.1 ms, Release 108 ms on Bass, 198 ms on Pad and 160 ms on Arp. Folding each stem's
level over the beat proved it: the Pad sits about 10 dB down right after each kick and recovers by the next one in
the Groove and Drop, and stays flat in the Breakdown, which has no kick. The Arp and Bass dip about the same.

## Building a Drum Rack

1. `track_insert_device(device_name: "Drum Rack")`.
2. `rack_device_insert_chain` adds a `DrumChain`. It defaults to `in_note: 36`.
3. `chain_set` sets the chain's `name`. `drum_chain_set` sets its `in_note`. They are different mutations.
4. `chain_insert_device(device_name: "Simpler")`.
5. `simpler_device_replace_sample(file_path:)` loads a file, including into an empty Simpler.
6. `simpler_device_set(playback_mode: 1)` makes it One-Shot, so a riser plays out however short its note.

`lq pad Drums 38 <file> -n Snare` does all of it, reusing the chain already on that note.

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
| `sidechain <track> <source> [-c tap -d dev]`                                    | Drives a Compressor from another track, or a chain inside it             |
| `pad <track> <note> <file> [-n name]`                                           | Puts a one-shot sample on a Drum Rack pad, adding the chain if missing   |
| `mix <track> vol=-8db pan=0 A=0.4`                                              | Volume, pan and sends by letter, as knob positions or decibels           |
| `clip <track> <slot> <lane>... [-l beats -g grid --gate -v vel -n name --fire]` | Replaces a slot's clip                                                   |
| `scene <i> [-n name] [--fire]`                                                  | Names or fires a scene, creating scenes up to its index                  |
| `arrange Intro:2 Drop:4`                                                        | Rebuilds the Arrangement from scenes. Rerunning converges                |
| `tempo`, `master`, `play`, `stop`, `save`                                       | `save` clicks File > Save Live Set                                       |
| `gql '<document>'`                                                              | The escape hatch                                                         |
| `load <track> <name> [--replace]`                                               | Loads the browser's first match onto a track, plug-ins included          |
| `omni <track> [-c category] [-p patch] [--list] [--glide off]`                  | Picks an Omnisphere patch by mouse, reading the browser with OCR         |
| `editor <track> [--close]`                                                      | Opens or closes a plug-in's editor                                       |
| `windows`, `shot [window] [-o png]`                                             | Lists Live's windows; captures one at one pixel per point                |
| `click <window> x y [--double]`, `keys cmd+f text return [--paced --native]`    | Drives Live and plug-in windows. `""` as the window is the Set           |
| `menu "File>Save Live Set"`                                                     | Clicks a menu item                                                       |
| `ax tree <window> [-f text]`, `ax press <window> <label>`, `ax set ... <value>` | Live's controls as text, and acting on them by label                     |
| `sweep <track> <param> <from> <to> <bars> [-d dev --curve --before]`            | Experimental: records a parameter ramp into the Arrangement              |
| `export <dir> [-n name --stems --start --bars]`, `levels <files> -s Name:a-b`   | Renders audio, then measures loudness and peaks per section              |
| `transpose <track> <semitones>`                                                 | Moves the notes in all of a track's Session and Arrangement clips        |
| `dump song.json`, `apply song.json [--dry-run]`                                 | Writes the Set as a song spec; makes the Set match one                   |

Lanes (`scripts/lq/notation.ts`): sequence tokens are a note (`A1`, Ableton octaves with C3 = 60), a chord
(`Am7@2`, `C@3^1` for the first inversion), `+` to stack, `.` rest, `-` hold, a `!` or `?` suffix for an
accent or a soft step, and `*96` for an exact velocity. A step lane is `C1:x..oX.-.` (hit, rest, soft, accent, hold). A lane repeats to the clip length.

## Melodic House, as built

122 BPM, A minor, chords Am, F, C, G a bar each. Scenes: 0 Groove, 1 Intro, 2 Breakdown, 3 Drop, 4 Build, 5 Lift,
6 Outro. The Arrangement is `arrange Intro:2 Groove:2 Lift:2 Breakdown:1 Build:1 Drop:2 Outro:1`, 64 bars (2:06),
and `song.json` beside the Set specs all of it. Breakdown, Build, Drop and Outro clips are 8 bars, so their phrases
don't repeat every 4. Every instrument but the drums is Omnisphere, chosen by name without hearing it. Bass, Pad and
Arp end in a Compressor keyed from the kick (see Sidechain pumping). Main ends in a Limiter (True Peak, ceiling
−1 dB).

| Bars  | Section   | What happens                                                                                   |
| ----- | --------- | ---------------------------------------------------------------------------------------------- |
| 1–8   | Intro     | Kick, hats and bass                                                                            |
| 9–16  | Groove    | Full groove, pumping                                                                           |
| 17–24 | Lift      | Busier hats, a snare fill every 4 bars, the lead's first phrase played soft                    |
| 25–32 | Breakdown | Crash and downsweep, no drums or bass, the lead's melody slow; the Arp's filter closes         |
| 33–40 | Build     | Snare from quarters to 16ths, kick out in bar 40, whoosh from bar 35 and a riser into the drop |
| 41–56 | Drop      | Crash, the full lead (a phrase and its answer over 8 bars), a snare fill into each half's end  |
| 57–64 | Outro     | Crash, kick out after bar 62, the Pad holds the last chord                                     |

| Track            | Device                                                                                                         | Notes                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bass             | Omnisphere: MTAUR - Ostinato Bass, GLIDE off, fader −10 dB                                                     | Offbeat eighths on the roots, MIDI 57, 53, 60, 55: an octave up, against a wobble at MIDI 45  |
| Drums            | Drum Rack: Kick 909 1 (36), Snare 909 Hard 1 (38), Clap 909 (39), Hihat Closed 909 (42), Hihat Open 909 (46)   | Kick every beat, clap on 2 and 4, open hat on offbeats, soft closed hats on the 16ths between |
| Pad              | Omnisphere: Jupiter and JX Warm Pad                                                                            | Am7, Fmaj7, C, G held a bar each; wider voicings in the Breakdown                             |
| Arp              | Omnisphere: Chill Plucker, then Auto Filter (Frequency automated)                                              | 16ths through the chord tones an octave up; 8ths in the Breakdown and Outro                   |
| Omni             | Omnisphere: Giant Trance Lead 1, GLIDE off                                                                     | Soft in the Lift, slow in the Breakdown, full in the Drop                                     |
| FX               | Drum Rack, one-shot: Crash 909 (36), Riser Whoosh Up (37), Riser White Noise (38), Sweep White Noise Fall (39) | Fader −6 dB, send 0.25                                                                        |
| A-Space (return) | Delay, Reverb                                                                                                  | Sends: Pad 0.45, Arp 0.55, Omni 0.35, FX 0.25, Drums 0.08                                     |

The Arp's Frequency is 0.58, drops to 0.15 at bar 25 and opens on a cubic curve to 0.62 at bar 41.

Measured from a stem export (LUFS / true peak dBFS): the mix runs Intro −18.2, Groove −15.4, Lift −15.7,
Breakdown −17.5, Build −16.3, Drop −13.5 / −1.0, Outro −20.0. Pumping costs the Pad about 4 LU against the
unducked Drop before. Drums climb from −23 dB RMS in bar 33 to −20 in bar 39 and fall to −24 in bar 40, when the
kick stops; the FX track rises from bar 35 and hits the crash at bar 41.

## Next

1. Extend the song spec to device parameters, sidechain routing and Drum Rack samples, so a Set rebuilds from the
   Seed. `lq pad` and `lq sidechain` are the pieces `apply` would call.
2. Generators over the notation: chord progressions in a key, arps from chords.
3. Several ramps in one recording pass, since each pass runs in real time. Clip envelopes are no way around it:
   creating them and inserting steps is Python-only, like Arrangement envelopes.
4. Listen to the Omnisphere picks and replace any that miss; the agent chose them by name.
