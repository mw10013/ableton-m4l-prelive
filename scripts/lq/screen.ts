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

const text = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

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

/** Brings Live forward unless it already is, which would move focus off a plug-in window. */
export const activate = jxa(
  `const live = Application("Live"); if (!live.frontmost()) { live.activate(); delay(0.3) } "ok"`,
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

const KEYS = new Set([
  "return",
  "enter",
  "esc",
  "tab",
  "space",
  "delete",
  "fwd-delete",
  "home",
  "end",
  "page-up",
  "page-down",
  "arrow-up",
  "arrow-down",
  "arrow-left",
  "arrow-right",
]);
const MODIFIERS = new Set(["cmd", "ctrl", "alt", "shift", "fn"]);

/**
 * cliclick commands for `keys`: a key name (`return`, `arrow-down`) presses it, `cmd+f` holds
 * the modifiers, anything else is typed as text, one character at a time.
 */
export const keyCommands = (tokens: readonly string[]): readonly string[] =>
  tokens.flatMap((token) => {
    const parts = token.split("+");
    const key = parts.at(-1) ?? "";
    const mods = parts.slice(0, -1);
    if (mods.length > 0 && mods.every((m) => MODIFIERS.has(m))) {
      const press = KEYS.has(key) ? `kp:${key}` : `t:${key}`;
      return [`kd:${mods.join(",")}`, press, `ku:${mods.join(",")}`];
    }
    if (KEYS.has(token)) return [`kp:${token}`];
    // One command per character, so `-w` paces them; plug-ins drop fast typing.
    return token.split("").map((c) => (c === " " ? "kp:space" : `t:${c}`));
  });

export const keys = Effect.fnUntraced(function* (tokens: readonly string[]) {
  yield* activate;
  yield* run("cliclick", ["-w", "50", ...keyCommands(tokens)]);
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
