/**
 * Live's windows, seen and driven from outside LiveQL: list them, capture one as a PNG, click
 * inside one, type keys and click menus. Uses osascript (JXA), `screencapture`, `sips` and
 * `cliclick`.
 *
 * A capture is scaled to the window's size in points, so a pixel in the PNG is the same point
 * that `click` takes, measured from the window's top-left corner.
 *
 * macOS attributes these calls to the app that launched the shell (T3 Code), which needs
 * Accessibility and Screen Recording. A sandboxed shell cannot capture at all.
 */
import * as CliError from "effect/cli/CliError";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";

export interface LiveWindow {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class ScreenError extends Data.TaggedError("ScreenError")<{
  readonly message: string;
}> {
  get [CliError.userMessage]() {
    return this.message;
  }
}

export const text = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
) => stream.pipe(Stream.decodeText(), Stream.mkString);

/** A command's stdout; a nonzero exit fails with its stderr. */
const run = Effect.fnUntraced(function* (
  command: string,
  args: readonly string[],
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(ChildProcess.make(command, args));
  const [stdout, stderr] = yield* Effect.all(
    [text(handle.stdout), text(handle.stderr)],
    { concurrency: 2 },
  );
  const code = yield* handle.exitCode;
  if (code !== ChildProcessSpawner.ExitCode(0))
    return yield* new ScreenError({
      message: stderr.trim() || `${command} exited with ${String(code)}`,
    });
  return stdout;
}, Effect.scoped);

const jxa = (script: string) =>
  run("osascript", ["-l", "JavaScript", "-e", script]);

const WINDOWS_SCRIPT = `
ObjC.import("CoreGraphics");
const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0));
const out = [];
for (let i = 0; i < list.count; i++) {
  const w = list.objectAtIndex(i);
  const get = (k) => ObjC.unwrap(w.objectForKey(k));
  const name = get("kCGWindowName");
  if (get("kCGWindowOwnerName") !== "Live" || !name) continue;
  const b = w.objectForKey("kCGWindowBounds");
  const n = (k) => ObjC.unwrap(b.objectForKey(k));
  out.push({ id: get("kCGWindowNumber"), name, x: n("X"), y: n("Y"), width: n("Width"), height: n("Height") });
}
JSON.stringify(out);`;

/** Live's named windows: the Set's main window, plug-in editors (`Omnisphere/Omni`) and panels. */
export const windows = run("osascript", [
  "-l",
  "JavaScript",
  "-e",
  WINDOWS_SCRIPT,
]).pipe(Effect.map((text) => JSON.parse(text) as readonly LiveWindow[]));

/** The window whose name contains `ref`, or the Set's window when `ref` is empty. Plug-in
 * editors are named `Device/Track`. */
export const findWindow = (all: readonly LiveWindow[], ref: string) => {
  if (ref === "")
    return all
      .filter((w) => !w.name.includes("/"))
      .toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
  const wanted = ref.toLowerCase();
  return all.find((w) => w.name.toLowerCase().includes(wanted));
};

/**
 * Brings Live forward unless it already is. It asks System Events, because asking Live itself
 * (`Application("Live").frontmost()`) moves keyboard focus off a plug-in window.
 */
export const activate = jxa(
  `const front = Application("System Events").processes.whose({ frontmost: true })[0].name();
   if (front !== "Live") { Application("Live").activate(); delay(0.3) } "ok"`,
);

/** Captures a window and scales it to points; `crop` is `x,y,width,height` in those points. */
export const capture = Effect.fnUntraced(function* (
  window: LiveWindow,
  path: string,
  crop?: readonly [number, number, number, number],
) {
  yield* run("screencapture", ["-x", "-o", "-l", String(window.id), path]);
  yield* run("sips", ["-z", String(window.height), String(window.width), path]);
  if (crop !== undefined) {
    const [x, y, width, height] = crop;
    yield* run("sips", [
      "-c",
      String(height),
      String(width),
      // sips centers the crop when an offset is 0, so the smallest offset is 1.
      "--cropOffset",
      String(Math.max(1, y)),
      String(Math.max(1, x)),
      path,
    ]);
  }
});

/** The RGB of one pixel of a PNG, read with ffmpeg. */
export const pixel = Effect.fnUntraced(function* (
  path: string,
  x: number,
  y: number,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const bytes = yield* Stream.runCollect(
    Stream.unwrap(
      spawner
        .spawn(
          ChildProcess.make("ffmpeg", [
            "-v",
            "error",
            "-i",
            path,
            "-vf",
            `crop=1:1:${String(Math.round(x))}:${String(Math.round(y))}`,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
          ]),
        )
        .pipe(Effect.map((handle) => handle.stdout)),
    ),
  );
  const [r = 0, g = 0, b = 0] = bytes.flatMap((chunk) => [...chunk]);
  return { r, g, b };
}, Effect.scoped);

const AX_SOURCE = `${import.meta.dirname}/ax.swift`;
const AX_BINARY = `${import.meta.dirname}/../../node_modules/.cache/lq/ax`;

/**
 * Runs the accessibility helper, compiling `ax.swift` first when it is newer than the binary.
 * JXA reads the same tree through System Events at about 15 seconds a window; this takes 0.4.
 */
export const ax = Effect.fnUntraced(function* (args: readonly string[]) {
  yield* run("sh", [
    "-c",
    `[ "$0" -nt "$1" ] || { mkdir -p "$(dirname "$0")" && swiftc -O "$1" -o "$0"; }`,
    AX_BINARY,
    AX_SOURCE,
  ]);
  return yield* run(AX_BINARY, args);
});

/** Clicks at `x`,`y` points inside `window`. Plug-in windows only show while Live is in front. */
export const click = Effect.fnUntraced(function* (
  window: LiveWindow,
  x: number,
  y: number,
  double: boolean,
) {
  yield* activate;
  const at = `${String(Math.round(window.x + x))},${String(Math.round(window.y + y))}`;
  yield* run("cliclick", [`${double ? "dc" : "c"}:${at}`]);
});

/** macOS virtual key codes for the keys `keys` presses by name. */
const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 76,
  esc: 53,
  tab: 48,
  space: 49,
  delete: 51,
  "fwd-delete": 117,
  home: 115,
  end: 119,
  "page-up": 116,
  "page-down": 121,
  "arrow-left": 123,
  "arrow-right": 124,
  "arrow-down": 125,
  "arrow-up": 126,
};
const MODIFIERS: Record<string, string> = {
  cmd: "command down",
  alt: "option down",
  shift: "shift down",
  ctrl: "control down",
};

export type KeyStep = { readonly cliclick: string } | { readonly jxa: string };

/**
 * The steps for `keys`. Shortcuts with modifiers (`cmd+f`) and text go through System Events,
 * where a modifier is part of the keystroke and cannot stay held down; cliclick's separate
 * key-down and key-up once left Cmd held, which turned typed text into shortcuts. A bare key name
 * (`return`, `arrow-down`) goes through cliclick, because Live's own UI ignores System Events'
 * key codes; `native` sends those through System Events instead, which macOS's own sheets need.
 * `paced` types one character at a time: Omnisphere drops fast typing.
 */
export const keySteps = (
  tokens: readonly string[],
  options: { readonly paced?: boolean; readonly native?: boolean } = {},
): readonly KeyStep[] =>
  tokens.flatMap((token): KeyStep[] => {
    const parts = token.split("+");
    const key = parts.at(-1) ?? "";
    const mods = parts.slice(0, -1);
    if (mods.length > 0 && mods.every((m) => m in MODIFIERS)) {
      const using = `, { using: ${JSON.stringify(mods.map((m) => MODIFIERS[m]))} }`;
      const code = KEY_CODES[key];
      return [
        {
          jxa:
            code === undefined
              ? `se.keystroke(${JSON.stringify(key)}${using})`
              : `se.keyCode(${String(code)}${using})`,
        },
      ];
    }
    const code = KEY_CODES[token];
    if (code !== undefined)
      return [
        options.native === true
          ? { jxa: `se.keyCode(${String(code)})` }
          : { cliclick: `kp:${token}` },
      ];
    if (options.paced !== true)
      return [{ jxa: `se.keystroke(${JSON.stringify(token)})` }];
    return token
      .split("")
      .map((c) => ({ jxa: `se.keystroke(${JSON.stringify(c)})` }));
  });

export const keys = Effect.fnUntraced(function* (
  tokens: readonly string[],
  options: { readonly paced?: boolean; readonly native?: boolean } = {},
) {
  yield* activate;
  // Consecutive cliclick keys go in one call: Live misses keys sent as separate calls.
  let pending: string[] = [];
  const flush = Effect.suspend(() => {
    const batch = pending;
    pending = [];
    return batch.length > 0
      ? run("cliclick", ["-w", "100", ...batch])
      : Effect.succeed("");
  });
  for (const step of keySteps(tokens, options)) {
    if ("cliclick" in step) {
      pending.push(step.cliclick);
      continue;
    }
    yield* flush;
    yield* jxa(`const se = Application("System Events"); ${step.jxa}; "ok"`);
    yield* Effect.sleep("100 millis");
  }
  yield* flush;
});

/** Clicks a menu item by path, as `File>Save Live Set`. */
export const menu = Effect.fnUntraced(function* (path: string) {
  const [top = "", ...items] = path.split(">").map((s) => s.trim());
  const chain = items
    .map((item) => `.menus[0].menuItems.byName(${JSON.stringify(item)})`)
    .join("");
  yield* jxa(
    `Application("System Events").processes.byName("Live").menuBars[0].menuBarItems.byName(${JSON.stringify(top)})${chain}.click(); "ok"`,
  );
});
