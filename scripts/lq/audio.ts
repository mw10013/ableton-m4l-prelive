/**
 * Listening by measurement: export audio from Live's Export Audio/Video dialog, then measure
 * loudness and peaks with ffmpeg.
 */
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as Screen from "./screen.ts";

/** Points in the Export Audio/Video dialog, measured from `shot export`. */
const DIALOG = {
  track: [215, 73],
  start: [212, 96],
  length: [212, 118],
} as const;

const waitFor = Effect.fnUntraced(function* (
  present: (windows: readonly Screen.LiveWindow[]) => boolean,
  what: string,
  seconds: number,
) {
  for (let i = 0; i < seconds * 4; i++) {
    if (present(yield* Screen.windows)) return;
    yield* Effect.sleep("250 millis");
  }
  return yield* new Screen.ScreenError({
    message: `timed out waiting for ${what}`,
  });
});

const hasWindow = (name: string) => (windows: readonly Screen.LiveWindow[]) =>
  windows.some((w) => w.name.startsWith(name));

/** The value `ax tree` reports for a dialog control. */
const axValue = Effect.fnUntraced(function* (label: string) {
  const tree = yield* Screen.ax(["tree", "export"]);
  const line = tree.split("\n").find((l) => l.includes(` ${label} = `));
  return line?.slice(line.indexOf(" = ") + 3).trim() ?? "";
});

export interface ExportOptions {
  readonly dir: string;
  readonly name: string;
  readonly start: number;
  readonly bars: number;
  readonly stems: boolean;
}

/**
 * Renders the Arrangement through File > Export Audio/Video. `stems` picks All Individual
 * Tracks, which writes one file per track plus the mix. Live reads the dialog's values only
 * from typing: `ax set` succeeds and changes nothing.
 */
export const exportAudio = Effect.fnUntraced(function* (
  options: ExportOptions,
) {
  yield* Screen.menu("File>Export Audio/Video...");
  yield* waitFor(hasWindow("Export Audio/Video"), "the export dialog", 10);
  yield* Effect.sleep("500 millis");
  const dialog = (yield* Screen.windows).find(
    (w) => w.name === "Export Audio/Video",
  );
  if (dialog === undefined)
    return yield* new Screen.ScreenError({ message: "no export dialog" });
  const at = (p: readonly [number, number]) =>
    Screen.click(dialog, p[0], p[1], false);

  // The popup lists Main, All Individual Tracks, then the tracks. Clicking an item does not
  // take, typing a name does nothing, and the arrows wrap around; Page Up goes to Main.
  const wanted = options.stems ? "All Individual Tracks" : "Main";
  if ((yield* axValue("Rendered Track Chooser")) !== wanted) {
    yield* at(DIALOG.track);
    yield* Effect.sleep("400 millis");
    yield* Screen.keys([
      "page-up",
      ...(options.stems ? ["arrow-down"] : []),
      "return",
    ]);
  }
  yield* at(DIALOG.start);
  yield* Screen.keys([String(options.start), "return"]);
  yield* at(DIALOG.length);
  yield* Screen.keys([String(options.bars), "return"]);
  if ((yield* axValue("Create Analysis File")) === "On")
    yield* Screen.ax(["press", "export", "Create Analysis File"]);

  const chosen = {
    track: yield* axValue("Rendered Track Chooser"),
    start: yield* axValue("Start of Rendered Sample (Bar)"),
    bars: yield* axValue("Length of Rendered Sample (Bar)"),
  };
  if (
    chosen.track !== wanted ||
    chosen.start !== String(options.start) ||
    chosen.bars !== String(options.bars)
  )
    return yield* new Screen.ScreenError({
      message: `export dialog shows ${chosen.track}, bar ${chosen.start}, ${chosen.bars} bars`,
    });

  // The press reports an error because the Save panel blocks it, but it goes through.
  yield* Screen.ax(["press", "export", "Export"]).pipe(Effect.ignore);
  yield* waitFor(hasWindow("Save"), "the Save panel", 10);
  yield* Effect.sleep("800 millis");
  // macOS's own sheets take Return through System Events, not cliclick.
  yield* Screen.keys(["cmd+shift+g"]);
  yield* Effect.sleep("800 millis");
  yield* Screen.keys(["cmd+a", options.dir]);
  yield* Effect.sleep("800 millis");
  yield* Screen.keys(["return"], { native: true });
  yield* Effect.sleep("1 second");
  yield* Screen.keys(["cmd+a", options.name]);
  yield* Effect.sleep("300 millis");
  yield* Screen.keys(["return"], { native: true });
  yield* waitFor(
    (windows) =>
      !windows.some((w) => w.name.startsWith("Export") || w.name === "Save"),
    "the export to finish",
    600,
  );
});

export interface Section {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

/** `Intro:1-9` is bars 1 to 8; the end bar is exclusive, as in `sweep`. */
export const parseSection = (text: string): Section | undefined => {
  const match = /^(?<name>[^:]+):(?<from>\d+)-(?<to>\d+)$/u.exec(text);
  if (match?.groups === undefined) return undefined;
  const from = Number(match.groups.from);
  const to = Number(match.groups.to);
  return to > from ? { name: match.groups.name ?? "", from, to } : undefined;
};

export interface Level {
  readonly lufs: number;
  readonly peak: number;
}

const number = (text: string | undefined) =>
  text === undefined || text === "-inf"
    ? Number.NEGATIVE_INFINITY
    : Number(text);

/** Integrated loudness and true peak of a file, or of the seconds from `from` to `to`. */
export const measure = Effect.fnUntraced(function* (
  file: string,
  from?: number,
  to?: number,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const trim = from === undefined ? "" : `atrim=${String(from)}:${String(to)},`;
  const handle = yield* spawner.spawn(
    ChildProcess.make("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-af",
      `${trim}ebur128=peak=true`,
      "-f",
      "null",
      "-",
    ]),
  );
  const [, stderr] = yield* Effect.all(
    [handle.stdout.pipe(Screen.text), handle.stderr.pipe(Screen.text)],
    { concurrency: 2 },
  );
  const summary = stderr.slice(stderr.lastIndexOf("Summary"));
  return {
    lufs: number(/I:\s+(?<v>-?[\d.]+|-inf)/u.exec(summary)?.groups?.v),
    peak: number(/Peak:\s+(?<v>-?[\d.]+|-inf)/u.exec(summary)?.groups?.v),
  } satisfies Level;
}, Effect.scoped);
