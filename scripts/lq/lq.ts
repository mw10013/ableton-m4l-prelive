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
        yield* lq.LqSetParam({ id: param.id, value: Number(value) });
        const { device_parameter } = yield* lq.LqParamText({
          id: param.id,
          value: Number(value),
        });
        out.push(
          `${name}=${value} (${device_parameter?.str_for_value ?? "?"})`,
        );
      }
      yield* Console.log(`${t.name}: ${out.join("; ")}`);
    }),
).pipe(
  Command.withDescription("Set volume, pan and sends: mix Pad vol=0.7 A=0.4"),
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
  },
  ({ window: ref, out }) =>
    Effect.gen(function* () {
      const window = yield* getWindow(ref);
      const slug = window.name.replaceAll(/[^A-Za-z0-9]+/gu, "-");
      const path = Option.getOrElse(out, () => `/tmp/lq-${slug}.png`);
      yield* Screen.capture(window, path);
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
  { keys: Argument.String("keys").pipe(Argument.variadic({ min: 1 })) },
  ({ keys }) =>
    Effect.gen(function* () {
      yield* Screen.keys(keys);
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
  { track: Argument.String("track"), name: Argument.String("name") },
  ({ track: ref, name }) =>
    Effect.gen(function* () {
      const set = yield* show;
      const track = yield* findTrack(set, ref);
      const view = set.view?.id;
      if (view === undefined) return yield* fail("no song view");
      yield* (yield* Lq).LqSelectTrack({ view, track: track.id });
      yield* Screen.keys(["cmd+f", name]);
      yield* Effect.sleep("1 second");
      yield* Screen.keys(["arrow-down", "return"]);
      yield* Effect.sleep("2 seconds");
      const after = yield* findTrack(yield* show, ref);
      yield* Console.log(trackLine(after, ref));
    }),
).pipe(
  Command.withDescription(
    "Load the browser's first match for a name onto a track, plug-ins included",
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
    editorCommand,
    windowsCommand,
    shotCommand,
    clickCommand,
    keysCommand,
    gqlCommand,
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(
    Layer.mergeAll(Lq.layer, FetchHttpClient.layer, NodeServices.layer),
  ),
  NodeRuntime.runMain,
);
