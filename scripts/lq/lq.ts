#!/usr/bin/env vpx
/**
 * `lq`: an experimental CLI for building Live Sets over LiveQL with few tokens in and out.
 * Run `vpx scripts/lq/lq.ts --help`. Tracks are named or numbered (`0` is the LiveQL track);
 * return tracks match with or without Live's letter prefix (`Space` finds `A-Space`).
 */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Argument from "effect/cli/Argument";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as GraphQLClient from "effect/graphql/GraphQLClient";
import * as GraphQLProtocol from "effect/graphql/GraphQLProtocol";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Audio from "./audio.ts";
import { LqGraphQLGroup, type LqShow } from "./lq.graphql.ts";
import { NotationError, type Note, parseLane } from "./notation.ts";
import * as Screen from "./screen.ts";

class LqError extends Data.TaggedError("LqError")<{
  readonly message: string;
}> {
  get [CliError.userMessage]() {
    return this.message;
  }
}

const fail = (message: string) => Effect.fail(new LqError({ message }));

const ENDPOINT = Config.String("LIVEQL_ENDPOINT").pipe(
  Config.withDefault("http://localhost:5100/graphql"),
);

const makeClient = GraphQLClient.make(LqGraphQLGroup);

class Lq extends Context.Service<Lq, Effect.Success<typeof makeClient>>()(
  "app/Lq",
) {
  static readonly layer = Layer.effect(Lq, makeClient).pipe(
    Layer.provide(
      Layer.unwrap(
        ENDPOINT.pipe(
          Effect.orDie,
          Effect.map((url) => GraphQLProtocol.layerHttp({ url })),
        ),
      ),
    ),
    Layer.provide(FetchHttpClient.layer),
  );
}

type LiveSet = LqShow.Result["live_set"];
type Track = NonNullable<LiveSet["tracks"]>[number];

const show = Effect.gen(function* () {
  const { live_set } = yield* (yield* Lq).LqShow();
  return live_set;
});

const allTracks = (set: LiveSet) => [
  ...(set.tracks ?? []),
  ...(set.return_tracks ?? []),
];

const findTrack = Effect.fnUntraced(function* (set: LiveSet, ref: string) {
  const tracks = allTracks(set);
  const byIndex = /^\d+$/u.test(ref) ? set.tracks?.[Number(ref)] : undefined;
  const wanted = ref.toLowerCase();
  const track =
    byIndex ??
    tracks.find((t) => t.name.toLowerCase() === wanted) ??
    tracks.find((t) => t.name.toLowerCase().replace(/^[a-z]-/u, "") === wanted);
  if (track === undefined) {
    return yield* fail(
      `no track ${ref}; tracks: ${tracks.map((t) => t.name).join(", ")}`,
    );
  }
  return track;
});

/** The named device, or the track's first device that is not the LiveQL device. */
const findDevice = Effect.fnUntraced(function* (
  track: Track,
  name: Option.Option<string>,
) {
  const devices = track.devices ?? [];
  const device = Option.match(name, {
    onNone: () => devices.find((d) => d.class_name !== "MxDeviceMidiEffect"),
    onSome: (n) =>
      devices.find((d) => (d.name ?? "").toLowerCase() === n.toLowerCase()),
  });
  if (device === undefined) {
    return yield* fail(
      `no device ${Option.getOrElse(name, () => "")} on ${track.name}; devices: ${devices.map((d) => d.name).join(", ")}`,
    );
  }
  return device;
});

const parseAssignment = Effect.fnUntraced(function* (text: string) {
  const at = text.lastIndexOf("=");
  if (at <= 0) return yield* fail(`expected name=value, got ${text}`);
  return { name: text.slice(0, at).trim(), value: text.slice(at + 1).trim() };
});

const round = (n: number | null | undefined) =>
  n === null || n === undefined ? "?" : String(Math.round(n * 1000) / 1000);

/** Sets parameters by name; a quantized parameter also takes one of its value_items. */
const setParams = Effect.fnUntraced(function* (
  deviceId: number,
  assignments: readonly string[],
) {
  const lq = yield* Lq;
  const { device } = yield* lq.LqDeviceParams({ id: deviceId });
  const params = device?.parameters ?? [];
  const out: string[] = [];
  for (const text of assignments) {
    const { name, value } = yield* parseAssignment(text);
    const param = params.find(
      (p) => p.name?.toLowerCase() === name.toLowerCase(),
    );
    if (param === undefined)
      return yield* fail(
        `no parameter "${name}" on ${device?.name ?? "device"}`,
      );
    const item =
      param.value_items?.findIndex(
        (v) => v.toLowerCase() === value.toLowerCase(),
      ) ?? -1;
    const number = item >= 0 ? item : Number(value);
    if (Number.isNaN(number))
      return yield* fail(`not a number or value item: ${text}`);
    const set = yield* lq.LqSetParam({ id: param.id, value: number });
    const { device_parameter } = yield* lq.LqParamText({
      id: param.id,
      value: set.device_parameter_set?.value ?? number,
    });
    out.push(
      `${param.name ?? name}=${round(set.device_parameter_set?.value)} (${device_parameter?.str_for_value ?? "?"})`,
    );
  }
  return out;
});

const PLUGIN_CLASSES = new Set(["AuPluginDevice", "PluginDevice"]);

/** Closes every plug-in editor, so none sits in front of the window being driven. */
const closeEditors = Effect.fnUntraced(function* (set: LiveSet) {
  const lq = yield* Lq;
  for (const t of allTracks(set))
    for (const d of t.devices ?? [])
      if (PLUGIN_CLASSES.has(d.class_name ?? ""))
        yield* lq.LqEditor({ id: d.id, open: false });
});

const trackLine = (t: Track, index: string) => {
  const mixer = t.mixer_device;
  const sends = (mixer?.sends ?? [])
    .map((s, i) => `${String.fromCodePoint(65 + i)}${round(s.value)}`)
    .join(" ");
  const devices = (t.devices ?? [])
    .filter((d) => d.class_name !== "MxDeviceMidiEffect")
    .map((d) => d.name)
    .join(",");
  const clips = (t.clip_slots ?? [])
    .flatMap((s, i) =>
      s.clip
        ? [
            `${String(i)}:${s.clip.name || "clip"}/${round(s.clip.length)}${s.clip.is_playing ? "▶" : ""}`,
          ]
        : [],
    )
    .join(" ");
  return `${index} ${t.name}${t.mute ? " (muted)" : ""} vol${round(mixer?.volume?.value)}${sends ? ` ${sends}` : ""} [${devices}] ${clips}`.trimEnd();
};

const showCommand = Command.make("show", {}, () =>
  Effect.gen(function* () {
    const set = yield* show;
    const master = set.master_track?.mixer_device?.volume?.value;
    yield* Console.log(
      `${set.name} ${round(set.tempo)}bpm ${set.is_playing ? "playing" : "stopped"} master${round(master)}`,
    );
    const scenes = (set.scenes ?? [])
      .map((s, i) => (s.name ? `${String(i)}:${s.name}` : ""))
      .filter(Boolean);
    if (scenes.length > 0) yield* Console.log(`scenes ${scenes.join(" ")}`);
    for (const [i, t] of (set.tracks ?? []).entries())
      yield* Console.log(trackLine(t, String(i)));
    for (const t of set.return_tracks ?? [])
      yield* Console.log(trackLine(t, "R"));
  }),
).pipe(
  Command.withDescription(
    "One line per track: volume, sends, devices, clips by slot",
  ),
);

const trackArg = Argument.String("track").pipe(
  Argument.withDescription("Track name or index"),
);
const deviceFlag = Flag.String("device").pipe(
  Flag.withAlias("d"),
  Flag.optional,
);

const paramsCommand = Command.make(
  "params",
  {
    track: trackArg,
    device: deviceFlag,
    filter: Flag.String("filter").pipe(Flag.withAlias("f"), Flag.optional),
  },
  ({ track, device, filter }) =>
    Effect.gen(function* () {
      const set = yield* show;
      const d = yield* findDevice(yield* findTrack(set, track), device);
      const { device: params } = yield* (yield* Lq).LqDeviceParams({
        id: d.id,
      });
      const wanted = Option.map(filter, (f) => f.toLowerCase());
      const lines = (params?.parameters ?? [])
        .filter((p) =>
          Option.match(wanted, {
            onNone: () => true,
            onSome: (f) => (p.name ?? "").toLowerCase().includes(f),
          }),
        )
        .map((p) =>
          p.is_quantized && p.value_items && p.value_items.length > 0
            ? `${p.name ?? "?"}=${p.value_items[p.value ?? 0] ?? round(p.value)} {${p.value_items.join("|")}}`
            : `${p.name ?? "?"}=${round(p.value)} [${round(p.min)}..${round(p.max)}]`,
        );
      yield* Console.log(`${d.name ?? "device"}: ${lines.join("; ")}`);
    }),
).pipe(Command.withDescription("List a device's parameters as name=value"));

const tweakCommand = Command.make(
  "tweak",
  {
    track: trackArg,
    device: deviceFlag,
    assignments: Argument.String("name=value").pipe(
      Argument.variadic({ min: 1 }),
    ),
  },
  ({ track, device, assignments }) =>
    Effect.gen(function* () {
      const set = yield* show;
      const d = yield* findDevice(yield* findTrack(set, track), device);
      yield* Console.log((yield* setParams(d.id, assignments)).join("; "));
    }),
).pipe(
  Command.withDescription(
    'Set device parameters by name: tweak Bass "LP Freq=0.4"',
  ),
);

/** The number a text starts with, as -6.0 in "-6.0 dB". */
const leadingNumber = (text: string) =>
  Number(/^\s*(?<n>[-+]?\d+(?:\.\d+)?)/u.exec(text)?.groups?.n ?? Number.NaN);

/**
 * The knob position whose text reads `db` decibels, found by bisection over `str_for_value`,
 * since volume and send knobs are 0..1 positions on a curve.
 */
const knobForDb = Effect.fnUntraced(function* (id: number, db: number) {
  const lq = yield* Lq;
  const dbAt = Effect.fnUntraced(function* (value: number) {
    const text =
      (yield* lq.LqParamText({ id, value })).device_parameter?.str_for_value ??
      "";
    return text.includes("inf")
      ? Number.NEGATIVE_INFINITY
      : leadingNumber(text);
  });
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if ((yield* dbAt(mid)) < db) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
});

const mixCommand = Command.make(
  "mix",
  {
    track: trackArg,
    assignments: Argument.String("vol|pan|A..=value").pipe(
      Argument.variadic({ min: 1 }),
    ),
  },
  ({ track, assignments }) =>
    Effect.gen(function* () {
      const set = yield* show;
      const t = yield* findTrack(set, track);
      const lq = yield* Lq;
      const out: string[] = [];
      for (const text of assignments) {
        const { name, value } = yield* parseAssignment(text);
        const key = name.toLowerCase();
        const sendIndex = /^[a-l]$/u.test(key)
          ? (key.codePointAt(0) ?? 97) - 97
          : -1;
        const param =
          key === "vol"
            ? t.mixer_device?.volume
            : key === "pan"
              ? t.mixer_device?.panning
              : sendIndex >= 0
                ? t.mixer_device?.sends?.[sendIndex]
                : undefined;
        if (param === undefined || param === null)
          return yield* fail(`no mixer control ${name} on ${t.name}`);
        const knob = /db$/iu.test(value)
          ? yield* knobForDb(param.id, leadingNumber(value))
          : Number(value);
        if (Number.isNaN(knob)) return yield* fail(`not a value: ${text}`);
        yield* lq.LqSetParam({ id: param.id, value: knob });
        const { device_parameter } = yield* lq.LqParamText({
          id: param.id,
          value: knob,
        });
        out.push(
          `${name}=${round(knob)} (${device_parameter?.str_for_value ?? "?"})`,
        );
      }
      yield* Console.log(`${t.name}: ${out.join("; ")}`);
    }),
).pipe(
  Command.withDescription(
    "Set volume, pan and sends as knob positions or decibels: mix Pad vol=-6db A=0.4",
  ),
);

const trackCommand = Command.make(
  "track",
  {
    name: Argument.String("name"),
    device: deviceFlag,
    assignments: Argument.String("name=value").pipe(Argument.variadic()),
  },
  ({ name, device, assignments }) =>
    Effect.gen(function* () {
      const lq = yield* Lq;
      let set = yield* show;
      let track = (set.tracks ?? []).find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      if (track === undefined) {
        const created = yield* lq.LqCreateMidiTrack({ song: set.id });
        const id = created.song_create_midi_track?.tracks?.at(-1)?.id;
        if (id === undefined) return yield* fail("Live made no track");
        yield* lq.LqRenameTrack({ id, name });
        set = yield* show;
        track = yield* findTrack(set, name);
        yield* Console.log(`created ${name}`);
      }
      if (
        Option.isSome(device) &&
        !(track.devices ?? []).some(
          (d) => (d.name ?? "").toLowerCase() === device.value.toLowerCase(),
        )
      ) {
        const inserted = yield* lq.LqInsertDevice({
          track: track.id,
          name: device.value,
        });
        const names =
          inserted.track_insert_device?.devices?.map((d) => d.name) ?? [];
        if (
          !names.some(
            (n) => (n ?? "").toLowerCase() === device.value.toLowerCase(),
          )
        ) {
          return yield* fail(
            `Live did not insert ${device.value}; ${name} has ${names.join(", ")}`,
          );
        }
        yield* Console.log(`inserted ${device.value}`);
        track = yield* findTrack(yield* show, name);
      }
      if (assignments.length > 0) {
        const d = yield* findDevice(track, device);
        yield* Console.log((yield* setParams(d.id, assignments)).join("; "));
      }
    }),
).pipe(
  Command.withDescription(
    "Make sure a MIDI track exists, optionally with a device, and set its parameters",
  ),
);

const clipCommand = Command.make(
  "clip",
  {
    track: trackArg,
    slot: Argument.Int("slot"),
    lanes: Argument.String("lane").pipe(Argument.variadic({ min: 1 })),
    length: Flag.Finite("length").pipe(
      Flag.withAlias("l"),
      Flag.withDefault(16),
    ),
    grid: Flag.Finite("grid").pipe(Flag.withAlias("g"), Flag.withDefault(0.25)),
    gate: Flag.Finite("gate").pipe(Flag.withDefault(0.9)),
    velocity: Flag.Int("velocity").pipe(
      Flag.withAlias("v"),
      Flag.withDefault(100),
    ),
    name: Flag.String("name").pipe(Flag.withAlias("n"), Flag.optional),
    fire: Flag.Boolean("fire").pipe(Flag.withDefault(false)),
  },
  ({ track, slot, lanes, length, grid, gate, velocity, name, fire }) =>
    Effect.gen(function* () {
      const lq = yield* Lq;
      const t = yield* findTrack(yield* show, track);
      const clipSlot = t.clip_slots?.[slot];
      if (clipSlot === undefined)
        return yield* fail(`${t.name} has no slot ${String(slot)}`);
      const notes = yield* Effect.try({
        try: () =>
          lanes.flatMap((lane): readonly Note[] =>
            parseLane(lane, { grid, length, velocity, gate }),
          ),
        catch: (e) =>
          new LqError({
            message: e instanceof NotationError ? e.message : String(e),
          }),
      });
      if (clipSlot.clip) yield* lq.LqDeleteClip({ slot: clipSlot.id });
      const created = yield* lq.LqCreateClip({ slot: clipSlot.id, length });
      const clipId = created.clip_slot_create_clip?.clip?.id;
      if (clipId === undefined || clipId === null)
        return yield* fail("Live made no clip");
      const clipName = Option.getOrElse(
        name,
        () => `${t.name} ${String(slot)}`,
      );
      yield* lq.LqWriteClip({ id: clipId, name: clipName, notes });
      if (fire) yield* lq.LqFireSlot({ id: clipSlot.id });
      yield* Console.log(
        `${t.name}:${String(slot)} "${clipName}" ${String(notes.length)} notes, ${String(length)} beats${fire ? ", fired" : ""}`,
      );
    }),
).pipe(
  Command.withDescription(
    'Replace a slot\'s clip with notes from lanes: clip Bass 0 ". A1 - ."',
  ),
);

const sceneCommand = Command.make(
  "scene",
  {
    index: Argument.Int("index"),
    name: Flag.String("name").pipe(Flag.withAlias("n"), Flag.optional),
    fire: Flag.Boolean("fire").pipe(Flag.withDefault(false)),
  },
  ({ index, name, fire }) =>
    Effect.gen(function* () {
      const lq = yield* Lq;
      let set = yield* show;
      while ((set.scenes ?? []).length <= index) {
        yield* lq.LqCreateScene({ song: set.id });
        set = yield* show;
      }
      const scene = set.scenes?.[index];
      if (scene === undefined) return yield* fail(`no scene ${String(index)}`);
      if (Option.isSome(name))
        yield* lq.LqRenameScene({ id: scene.id, name: name.value });
      if (fire) yield* lq.LqFireScene({ id: scene.id });
      yield* Console.log(
        `scene ${String(index)}${Option.isSome(name) ? ` "${name.value}"` : ""}${fire ? " fired" : ""}`,
      );
    }),
).pipe(
  Command.withDescription(
    "Name or fire a scene, creating scenes up to its index",
  ),
);

const tempoCommand = Command.make(
  "tempo",
  { bpm: Argument.Finite("bpm") },
  ({ bpm }) =>
    Effect.gen(function* () {
      const set = yield* show;
      yield* (yield* Lq).LqSetTempo({ song: set.id, tempo: bpm });
      yield* Console.log(`${String(bpm)}bpm`);
    }),
);

const masterCommand = Command.make(
  "master",
  { volume: Argument.Finite("volume") },
  ({ volume }) =>
    Effect.gen(function* () {
      const set = yield* show;
      const param = set.master_track?.mixer_device?.volume;
      if (param === undefined || param === null)
        return yield* fail("no master volume");
      const lq = yield* Lq;
      yield* lq.LqSetParam({ id: param.id, value: volume });
      const { device_parameter } = yield* lq.LqParamText({
        id: param.id,
        value: volume,
      });
      yield* Console.log(`master ${device_parameter?.str_for_value ?? "?"}`);
    }),
).pipe(
  Command.withDescription("Master volume, 0..1 (0.85 is 0 dB, 0 is silent)"),
);

const playCommand = Command.make("play", {}, () =>
  Effect.gen(function* () {
    yield* (yield* Lq).LqPlay({ song: (yield* show).id });
    yield* Console.log("playing");
  }),
);

const stopCommand = Command.make("stop", {}, () =>
  Effect.gen(function* () {
    yield* (yield* Lq).LqStop({ song: (yield* show).id });
    yield* Console.log("stopped");
  }),
);

/** LiveQL cannot save; this clicks File > Save Live Set through Accessibility. */
const saveCommand = Command.make("save", {}, () =>
  Effect.gen(function* () {
    yield* Screen.menu("File>Save Live Set");
    yield* Console.log("saved");
  }),
).pipe(Command.withDescription("File > Save Live Set"));

const menuCommand = Command.make(
  "menu",
  { path: Argument.String("menu>item") },
  ({ path }) =>
    Effect.gen(function* () {
      yield* Screen.menu(path);
      yield* Console.log(path);
    }),
).pipe(
  Command.withDescription('Click a Live menu item: menu "File>Save Live Set"'),
);

const windowLine = (w: Screen.LiveWindow) =>
  `${w.name} ${String(w.width)}x${String(w.height)} at ${String(w.x)},${String(w.y)}`;

const windowsCommand = Command.make("windows", {}, () =>
  Effect.gen(function* () {
    for (const w of yield* Screen.windows) yield* Console.log(windowLine(w));
  }),
).pipe(Command.withDescription("Live's windows, with their size in points"));

const getWindow = Effect.fnUntraced(function* (ref: string) {
  const all = yield* Screen.windows;
  const window = Screen.findWindow(all, ref);
  if (window === undefined)
    return yield* fail(
      `no window ${ref}; windows: ${all.map((w) => w.name).join(", ")}`,
    );
  return window;
});

const windowArgument = Argument.String("window").pipe(
  Argument.withDescription("Part of a window's name; empty is the Set"),
  Argument.withDefault(""),
);

/** A PNG of one window, at one pixel per point so its coordinates are `click` coordinates. */
const shotCommand = Command.make(
  "shot",
  {
    window: windowArgument,
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.optional),
    crop: Flag.String("crop").pipe(
      Flag.withAlias("c"),
      Flag.withDescription("x,y,width,height in points"),
      Flag.optional,
    ),
  },
  ({ window: ref, out, crop }) =>
    Effect.gen(function* () {
      const window = yield* getWindow(ref);
      const slug = window.name.replaceAll(/[^A-Za-z0-9]+/gu, "-");
      const path = Option.getOrElse(out, () => `/tmp/lq-${slug}.png`);
      const box = Option.getOrUndefined(crop)?.split(",").map(Number);
      if (box !== undefined && (box.length !== 4 || box.some(Number.isNaN)))
        return yield* fail("--crop takes x,y,width,height");
      yield* Screen.capture(
        window,
        path,
        box as [number, number, number, number] | undefined,
      );
      yield* Console.log(`${path} ${windowLine(window)}`);
    }),
).pipe(Command.withDescription("Capture a Live window as a PNG"));

const clickCommand = Command.make(
  "click",
  {
    window: Argument.String("window"),
    x: Argument.Finite("x"),
    y: Argument.Finite("y"),
    double: Flag.Boolean("double").pipe(Flag.withDefault(false)),
  },
  ({ window: ref, x, y, double }) =>
    Effect.gen(function* () {
      const window = yield* getWindow(ref);
      yield* Screen.click(window, x, y, double);
      yield* Console.log(`clicked ${window.name} ${String(x)},${String(y)}`);
    }),
).pipe(
  Command.withDescription(
    'Click inside a window, in the points of its shot; "" is the Set',
  ),
);

const keysCommand = Command.make(
  "keys",
  {
    keys: Argument.String("keys").pipe(Argument.variadic({ min: 1 })),
    paced: Flag.Boolean("paced").pipe(
      Flag.withDescription("Type one character at a time, for plug-ins"),
      Flag.withDefault(false),
    ),
    native: Flag.Boolean("native").pipe(
      Flag.withDescription(
        "Send key names through System Events, for macOS panels and sheets",
      ),
      Flag.withDefault(false),
    ),
  },
  ({ keys, paced, native }) =>
    Effect.gen(function* () {
      yield* Screen.keys(keys, { paced, native });
      yield* Console.log(keys.join(" "));
    }),
).pipe(
  Command.withDescription(
    "Bring Live forward and press keys: keys cmd+f Reverb arrow-down return",
  ),
);

const editorCommand = Command.make(
  "editor",
  {
    track: Argument.String("track"),
    close: Flag.Boolean("close").pipe(Flag.withDefault(false)),
  },
  ({ track: ref, close }) =>
    Effect.gen(function* () {
      const device = yield* findDevice(
        yield* findTrack(yield* show, ref),
        Option.none(),
      );
      yield* (yield* Lq).LqEditor({ id: device.id, open: !close });
      yield* Console.log(
        `${device.name ?? "device"} editor ${close ? "closed" : "open"}`,
      );
    }),
).pipe(Command.withDescription("Open or close a plug-in's editor window"));

/**
 * Loads anything Live's browser can find onto a track, plug-ins included: selects the track,
 * then searches the browser and loads the first result.
 */
const loadCommand = Command.make(
  "load",
  {
    track: Argument.String("track"),
    name: Argument.String("name"),
    replace: Flag.Boolean("replace").pipe(
      Flag.withDescription("Delete the track's devices first, except LiveQL"),
      Flag.withDefault(false),
    ),
  },
  ({ track: ref, name, replace }) =>
    Effect.gen(function* () {
      const lq = yield* Lq;
      const set = yield* show;
      const track = yield* findTrack(set, ref);
      const view = set.view?.id;
      if (view === undefined) return yield* fail("no song view");
      if (replace) {
        const devices = track.devices ?? [];
        // Delete from the end so the remaining indexes stay valid.
        for (let i = devices.length - 1; i >= 0; i--)
          if (devices[i]?.class_name !== "MxDeviceMidiEffect")
            yield* lq.LqDeleteDevice({ track: track.id, index: i });
      }
      // Live sometimes ignores a selection, and the browser loads onto whatever is selected.
      let selected = "";
      for (let i = 0; i < 5 && selected !== track.name; i++) {
        selected =
          (yield* lq.LqSelectTrack({ view, track: track.id })).song_view_set
            ?.selected_track?.name ?? "";
        if (selected !== track.name) yield* Effect.sleep("300 millis");
      }
      if (selected !== track.name)
        return yield* fail(
          `could not select ${track.name}; ${selected} is selected`,
        );
      // A plug-in editor in front would take the keystrokes meant for the browser.
      yield* closeEditors(replace ? yield* show : set);
      yield* Screen.keys(["cmd+f", name]);
      yield* Effect.sleep("1 second");
      yield* Screen.keys(["arrow-down", "return"]);
      yield* Effect.sleep("2 seconds");
      const loaded = yield* show;
      yield* closeEditors(loaded);
      const after = yield* findTrack(loaded, ref);
      yield* Console.log(trackLine(after, ref));
    }),
).pipe(
  Command.withDescription(
    "Load the browser's first match for a name onto a track, plug-ins included",
  ),
);

/** Points in Omnisphere's editor at its default size, measured from `shot`. */
const OMNI = {
  clear: [293, 125],
  search: [165, 125],
  firstResult: [130, 504],
  rowHeight: 20.4,
  glide: [1261, 534],
  glideSample: [1236, 534],
  list: [18, 490, 292, 275],
  patch: [560, 200, 520, 260],
} as const;

/**
 * Loads an Omnisphere patch by searching its browser, since the LOM cannot see its patches.
 * `--list` only shows the results. Either way it saves a cropped shot to check by eye.
 */
const omniCommand = Command.make(
  "omni",
  {
    track: Argument.String("track"),
    search: Argument.String("search"),
    pick: Flag.Int("pick").pipe(
      Flag.withAlias("p"),
      Flag.withDescription("Which result to load, from 1"),
      Flag.withDefault(1),
    ),
    list: Flag.Boolean("list").pipe(
      Flag.withDescription("Show the results without loading one"),
      Flag.withDefault(false),
    ),
    glide: Flag.ChoiceWithValue("glide", [
      ["on", "on"],
      ["off", "off"],
    ] as const).pipe(
      Flag.withDescription(
        "Turn the patch's portamento on or off after loading",
      ),
      Flag.optional,
    ),
  },
  ({ track: ref, search, pick, list, glide }) =>
    Effect.gen(function* () {
      const set = yield* show;
      const track = yield* findTrack(set, ref);
      const device = (track.devices ?? []).find((d) => d.name === "Omnisphere");
      if (device === undefined)
        return yield* fail(`no Omnisphere on ${track.name}`);
      yield* closeEditors(set);
      yield* (yield* Lq).LqEditor({ id: device.id, open: true });
      yield* Screen.activate;
      const title = `omnisphere/${track.name.toLowerCase()}`;
      let window: Screen.LiveWindow | undefined;
      for (let i = 0; i < 20 && window === undefined; i++) {
        window = (yield* Screen.windows).find(
          (w) => w.name.toLowerCase() === title,
        );
        if (window === undefined) yield* Effect.sleep("250 millis");
      }
      if (window === undefined) return yield* fail(`no window ${title}`);
      const at = (p: readonly [number, number]) =>
        Screen.click(window, p[0], p[1], false);
      // A newly opened editor takes a moment, and its first click only focuses the window.
      yield* Effect.sleep("1 second");
      yield* at(OMNI.clear);
      yield* at(OMNI.search);
      yield* at(OMNI.search);
      yield* Screen.keys([search, "return"], { paced: true });
      yield* Effect.sleep("1500 millis");
      if (!list) {
        yield* at([
          OMNI.firstResult[0],
          OMNI.firstResult[1] + (pick - 1) * OMNI.rowHeight,
        ]);
        yield* Effect.sleep("4 seconds");
      }
      const path = `/tmp/lq-omni-${track.name}.png`;
      if (!list && Option.isSome(glide)) {
        // GLIDE lights cyan when on and is grey when off.
        const isOn = Effect.gen(function* () {
          yield* Screen.capture(window, path);
          const { r, b } = yield* Screen.pixel(path, ...OMNI.glideSample);
          return b - r > 60;
        });
        if ((yield* isOn) !== (glide.value === "on")) {
          yield* at(OMNI.glide);
          yield* Effect.sleep("500 millis");
        }
        yield* Console.log(`glide ${(yield* isOn) ? "on" : "off"}`);
      }
      yield* Screen.capture(window, path, list ? OMNI.list : OMNI.patch);
      yield* Console.log(path);
    }),
).pipe(
  Command.withDescription(
    'Search Omnisphere\'s patch browser on a track and load a result: omni Pad "warm pad" -p 2',
  ),
);

/**
 * Rebuilds the Arrangement from scenes: `arrange Intro:2 Drop:4` plays each scene's clips
 * that many times in order. It first deletes every Arrangement clip, so rerunning converges.
 */
const arrangeCommand = Command.make(
  "arrange",
  {
    sections: Argument.String("scene:repeats").pipe(
      Argument.variadic({ min: 1 }),
    ),
  },
  ({ sections }) =>
    Effect.gen(function* () {
      const lq = yield* Lq;
      const set = yield* show;
      const scenes = set.scenes ?? [];
      const tracks = set.tracks ?? [];
      for (const t of tracks)
        for (const c of t.arrangement_clips ?? [])
          yield* lq.LqDeleteTrackClip({ track: t.id, clip: c.id });
      let time = 0;
      const out: string[] = [];
      for (const section of sections) {
        const [ref = "", repeatText = "1"] = section.split(":");
        const index = /^\d+$/u.test(ref)
          ? Number(ref)
          : scenes.findIndex((s) => s.name.toLowerCase() === ref.toLowerCase());
        if (index < 0 || index >= scenes.length)
          return yield* fail(`no scene ${ref}`);
        const repeats = Number(repeatText);
        const clips = tracks.flatMap((t) => {
          const clip = t.clip_slots?.[index]?.clip;
          return clip ? [{ track: t.id, clip }] : [];
        });
        const length = Math.max(
          ...clips.map(({ clip }) => clip.length ?? 0),
          4,
        );
        for (let k = 0; k < repeats; k++)
          for (const { track, clip } of clips)
            yield* lq.LqToArrangement({
              track,
              clip: clip.id,
              time: time + k * length,
            });
        out.push(`${ref}@${String(time / 4 + 1)}`);
        time += repeats * length;
      }
      yield* Console.log(`${out.join(" ")}, ${String(time / 4)} bars`);
    }),
).pipe(
  Command.withDescription(
    "Lay scenes into the Arrangement: arrange Intro:2 Drop:4",
  ),
);

/**
 * Live's accessibility tree: every labeled control in a window with its value, as text.
 * `press` and `set` act on a control by label; `Group/Label` narrows the search.
 */
const axCommand = Command.make(
  "ax",
  {
    action: Argument.ChoiceWithValue("action", [
      ["tree", "tree"],
      ["press", "press"],
      ["set", "set"],
    ] as const),
    window: Argument.String("window"),
    label: Argument.String("label").pipe(Argument.optional),
    value: Argument.String("value").pipe(Argument.optional),
    filter: Flag.String("filter").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Only tree lines containing this text"),
      Flag.optional,
    ),
  },
  ({ action, window, label, value, filter }) =>
    Effect.gen(function* () {
      const args = [
        action,
        window,
        ...Option.toArray(label),
        ...Option.toArray(value),
      ];
      const text = yield* Screen.ax(args);
      const wanted = Option.map(filter, (f) => f.toLowerCase());
      yield* Console.log(
        Option.match(wanted, {
          onNone: () => text.trimEnd(),
          onSome: (f) =>
            text
              .split("\n")
              .filter((l) => l.toLowerCase().includes(f))
              .join("\n"),
        }),
      );
    }),
).pipe(
  Command.withDescription(
    'Read or drive Live\'s controls by label: ax tree "" -f volume, ax press "" "Automation Mode"',
  ),
);

/**
 * Experimental: records a parameter ramp into the Arrangement by moving the parameter while Live
 * records, since the LOM cannot write automation envelopes.
 */
const sweepCommand = Command.make(
  "sweep",
  {
    track: trackArg,
    param: Argument.String("param"),
    from: Argument.Finite("from"),
    to: Argument.Finite("to"),
    bars: Argument.String("bars").pipe(
      Argument.withDescription("start-end bars, as 17-25"),
    ),
    device: deviceFlag,
    curve: Flag.Finite("curve").pipe(
      Flag.withDescription("Exponent on the ramp; 2 starts slow"),
      Flag.withDefault(1),
    ),
    before: Flag.Finite("before").pipe(
      Flag.withDescription(
        "Value before the ramp, written in the pre-roll bar; default is the current value",
      ),
      Flag.optional,
    ),
  },
  ({ track: ref, param: name, from, to, bars, device, curve, before }) =>
    Effect.gen(function* () {
      const lq = yield* Lq;
      const set = yield* show;
      const d = yield* findDevice(yield* findTrack(set, ref), device);
      const params = (yield* lq.LqDeviceParams({ id: d.id })).device
        ?.parameters;
      const param = params?.find(
        (p) => p.name?.toLowerCase() === name.toLowerCase(),
      );
      if (param === undefined) return yield* fail(`no parameter ${name}`);
      const [startBar = Number.NaN, endBar = Number.NaN] = bars
        .split("-")
        .map(Number);
      if (Number.isNaN(startBar) || Number.isNaN(endBar) || endBar <= startBar)
        return yield* fail("bars must be start-end, as 17-25");
      const start = (startBar - 1) * 4;
      const end = (endBar - 1) * 4;
      const song = set.id;

      // Recording writes the parameter's value where it starts, and automation holds its
      // first point back to the start of the song, so the pre-roll bar keeps `held`.
      const held = Option.getOrElse(before, () => param.value ?? from);
      yield* lq.LqSetParam({ id: param.id, value: held });
      yield* lq.LqSongSet({
        song,
        properties: [{ start_time: Math.max(0, start - 4) }],
      });
      yield* lq.LqSongSet({ song, properties: [{ record_mode: true }] });
      yield* lq.LqPlay({ song });

      let writes = 0;
      let last = Number.NaN;
      const began = Date.now();
      for (;;) {
        const time = (yield* lq.LqSongTime()).live_set.current_song_time ?? 0;
        if (time >= end) break;
        if (time >= start) {
          const t = ((time - start) / (end - start)) ** curve;
          const value = from + (to - from) * t;
          if (Number.isNaN(last) || Math.abs(value - last) > 0.002) {
            yield* lq.LqSetParam({ id: param.id, value });
            last = value;
            writes++;
          }
        }
      }
      yield* lq.LqSetParam({ id: param.id, value: to });
      yield* lq.LqSongSet({ song, properties: [{ start_time: 0 }] });
      yield* lq.LqStop({ song });
      yield* lq.LqSongSet({ song, properties: [{ record_mode: false }] });
      const state = (yield* lq.LqParamState({ id: param.id })).device_parameter;
      const seconds = (Date.now() - began) / 1000;
      yield* Console.log(
        `${param.name ?? name} ${String(from)}→${String(to)} bars ${bars}: ${String(writes)} writes in ${seconds.toFixed(1)}s, automation_state ${String(state?.automation_state)}`,
      );
    }),
).pipe(
  Command.withDescription(
    "Experimental: record a parameter ramp into the Arrangement while Live plays",
  ),
);

const exportCommand = Command.make(
  "export",
  {
    dir: Argument.String("dir").pipe(
      Argument.withDescription("An existing folder to save into"),
    ),
    name: Flag.String("name").pipe(
      Flag.withAlias("n"),
      Flag.withDefault("mix"),
    ),
    start: Flag.Int("start").pipe(Flag.withDefault(1)),
    bars: Flag.Int("bars").pipe(
      Flag.withDescription("Default: through the last Arrangement clip"),
      Flag.optional,
    ),
    stems: Flag.Boolean("stems").pipe(
      Flag.withDescription("One file per track, plus the mix"),
      Flag.withDefault(false),
    ),
  },
  ({ dir, name, start, bars, stems }) =>
    Effect.gen(function* () {
      const set = yield* show;
      const end = Math.max(
        0,
        ...allTracks(set).flatMap((t) =>
          (t.arrangement_clips ?? []).map(
            (c) => (c.start_time ?? 0) + (c.length ?? 0),
          ),
        ),
      );
      const length = Option.getOrElse(
        bars,
        () => Math.ceil(end / 4) - start + 1,
      );
      yield* closeEditors(set);
      yield* Audio.exportAudio({ dir, name, start, bars: length, stems });
      yield* Console.log(
        `exported bars ${String(start)}-${String(start + length - 1)} to ${dir}`,
      );
    }),
).pipe(
  Command.withDescription(
    "Render the Arrangement through File > Export Audio/Video: export /tmp/mh --stems",
  ),
);

const levelsCommand = Command.make(
  "levels",
  {
    files: Argument.String("file").pipe(Argument.variadic({ min: 1 })),
    sections: Flag.String("section").pipe(
      Flag.withAlias("s"),
      Flag.withDescription("Name:from-to bars, end exclusive; repeatable"),
      Flag.atLeast(0),
    ),
  },
  ({ files, sections }) =>
    Effect.gen(function* () {
      const tempo = (yield* show).tempo ?? 120;
      const bar = (4 * 60) / tempo;
      const parsed: Audio.Section[] = [];
      for (const text of sections) {
        const section = Audio.parseSection(text);
        if (section === undefined)
          return yield* fail(`--section takes Name:from-to, got ${text}`);
        parsed.push(section);
      }
      const cell = (l: Audio.Level) =>
        `${l.lufs.toFixed(1).padStart(6)} ${l.peak.toFixed(1).padStart(5)}`;
      yield* Console.log(
        [
          "file".padEnd(16),
          "whole LUFS/pk".padStart(12),
          ...parsed.map((s) => s.name.padStart(12)),
        ].join(" "),
      );
      for (const file of files) {
        const cells = [cell(yield* Audio.measure(file))];
        for (const s of parsed)
          cells.push(
            cell(
              yield* Audio.measure(file, (s.from - 1) * bar, (s.to - 1) * bar),
            ),
          );
        const label = (file.split("/").at(-1) ?? file).replace(/\.aif$/u, "");
        yield* Console.log(
          [
            label.padEnd(16).slice(0, 16),
            ...cells.map((c) => c.padStart(12)),
          ].join(" "),
        );
      }
    }),
).pipe(
  Command.withDescription(
    "Loudness (LUFS) and true peak (dBFS) per file and section: levels *.aif -s Drop:25-41",
  ),
);

/** Moves every note in a track's Session and Arrangement clips by `semitones`. */
const transposeCommand = Command.make(
  "transpose",
  { track: trackArg, semitones: Argument.Int("semitones") },
  ({ track: ref, semitones }) =>
    Effect.gen(function* () {
      const lq = yield* Lq;
      const track = yield* findTrack(yield* show, ref);
      const clips = [
        ...(track.clip_slots ?? []).flatMap((s) => (s.clip ? [s.clip.id] : [])),
        ...(track.arrangement_clips ?? []).map((c) => c.id),
      ];
      let moved = 0;
      for (const id of clips) {
        const notes =
          (yield* lq.LqClipNotes({ id })).clip?.get_all_notes_extended?.notes ??
          [];
        if (notes.length === 0) continue;
        yield* lq.LqModifyNotes({
          id,
          notes: notes.map((n) => ({
            note_id: n.note_id,
            pitch: Math.max(0, Math.min(127, n.pitch + semitones)),
          })),
        });
        moved += notes.length;
      }
      yield* Console.log(
        `${track.name}: ${String(moved)} notes in ${String(clips.length)} clips moved ${String(semitones)} semitones`,
      );
    }),
).pipe(
  Command.withDescription(
    "Move a track's notes in every Session and Arrangement clip: transpose Bass 12",
  ),
);

/** The escape hatch: any GraphQL document, printed as compact JSON. */
const gqlCommand = Command.make(
  "gql",
  { query: Argument.String("query") },
  ({ query }) =>
    Effect.gen(function* () {
      const url = yield* ENDPOINT;
      const body = yield* HttpClientRequest.post(url).pipe(
        HttpClientRequest.bodyJsonUnsafe({ query }),
        (yield* HttpClient.HttpClient).execute,
        Effect.flatMap((r) => r.json),
      );
      yield* Console.log(JSON.stringify(body));
    }),
).pipe(Command.withDescription("Send a raw GraphQL document"));

Command.make("lq").pipe(
  Command.withDescription("Build Live Sets over LiveQL"),
  Command.withSubcommands([
    showCommand,
    paramsCommand,
    tweakCommand,
    mixCommand,
    trackCommand,
    clipCommand,
    sceneCommand,
    tempoCommand,
    masterCommand,
    playCommand,
    stopCommand,
    saveCommand,
    menuCommand,
    arrangeCommand,
    loadCommand,
    omniCommand,
    editorCommand,
    windowsCommand,
    shotCommand,
    clickCommand,
    keysCommand,
    axCommand,
    sweepCommand,
    exportCommand,
    levelsCommand,
    transposeCommand,
    gqlCommand,
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(
    Layer.mergeAll(Lq.layer, FetchHttpClient.layer, NodeServices.layer),
  ),
  NodeRuntime.runMain,
);
