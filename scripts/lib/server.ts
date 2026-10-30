/**
 * This checkout's dev server: `scripts/serve.ts` running Vite behind `s6-log`. Here is how it
 * is found, probed, started where it belongs ({@link startServer}) and stopped
 * ({@link stopServer}).
 *
 * @module
 */
import * as Array from "effect/Array";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runCommand } from "./command.ts";
import * as Herdr from "./herdr.ts";

/** This checkout's root, where the server runs and every path below is relative to. */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(
  /\/$/u,
  "",
);

/** The port `vite.config.ts` serves on; `serve.ts` passes `--strictPort` so Vite never drifts. */
export const PORT = 4500;
export const SERVER_URL = `http://localhost:${String(PORT)}/`;
export const LOG = ".logs/dev/current";
const LOCK = ".logs/dev.lock";
const TAB = "dev";
/** The package script that runs the server in the foreground: `scripts/serve.ts`. */
const SCRIPT = "dev:server";

const START_TIMEOUT = Duration.minutes(1);
const STOP_TIMEOUT = Duration.seconds(15);

export class ServerError extends Schema.TaggedError<ServerError>()(
  "ServerError",
  {
    message: Schema.String,
  },
) {}

const fail = (message: string) => new ServerError({ message });

const Pid = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
);
const decodePid = Schema.decodeUnknownResult(Pid);

const pidsFrom = (output: string) =>
  Array.filterMap(output.split("\n"), (line) => decodePid(line.trim()));

export const portListeners = runCommand("lsof", [
  "-t",
  `-iTCP:${String(PORT)}`,
  "-sTCP:LISTEN",
  "-nP",
]).pipe(
  Effect.map(pidsFrom),
  Effect.orElseSucceed((): number[] => []),
);

/** Any HTTP answer counts: the first request after a start waits on Vite's compile. */
export const answering = Effect.tryPromise(() =>
  fetch(SERVER_URL, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  }),
).pipe(Effect.option, Effect.map(Option.isSome));

/** Polls `check` every `interval` until it is true; false once `timeout` passes first. */
const waitUntil = <E, R>(
  check: Effect.Effect<boolean, E, R>,
  timeout: Duration.Duration,
  interval: Duration.Duration,
) =>
  check.pipe(
    Effect.repeat({
      until: (ready) => ready,
      schedule: Schedule.spaced(interval),
    }),
    Effect.timeoutOption(timeout),
    Effect.map(Option.isSome),
  );

const cwdOf = (pid: number) =>
  runCommand("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).pipe(
    Effect.map((output) =>
      Option.fromUndefinedOr(
        output
          .split("\n")
          .find((line) => line.startsWith("n"))
          ?.slice(1),
      ),
    ),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

/**
 * The server's processes, as `pgrep -f` matches them: `scripts/serve.ts` and the Vite dev CLI it
 * runs, whose command line is `node …/vite/bin/vite.js dev`.
 * Another checkout runs the same commands, so each match must also work in this checkout.
 */
const SERVER_PROCESS = String.raw`scripts/serve\.ts|/vite/bin/vite\.js dev`;
const isServerCommand = Schema.is(
  Schema.String.check(Schema.isPattern(new RegExp(SERVER_PROCESS, "u"))),
);

export const serverPids = runCommand("pgrep", ["-f", SERVER_PROCESS]).pipe(
  Effect.map(pidsFrom),
  Effect.orElseSucceed((): number[] => []),
  Effect.flatMap((pids) =>
    Effect.forEach(pids, (pid) =>
      cwdOf(pid).pipe(
        Effect.map((cwd) => (Option.contains(cwd, ROOT) ? [pid] : [])),
      ),
    ),
  ),
  Effect.map((pids) => pids.flat()),
);

/** `pids` and every process below them. */
const withDescendants = (pids: readonly number[]) =>
  runCommand("ps", ["-A", "-o", "pid=,ppid="]).pipe(
    Effect.map((output) => {
      const children = new Map<number, number[]>();
      for (const line of output.split("\n")) {
        const [pid, ppid] = line.trim().split(/\s+/u).map(Number);
        if (pid === undefined || ppid === undefined) continue;
        children.set(ppid, [...(children.get(ppid) ?? []), pid]);
      }
      const found = new Set<number>();
      const visit = (pid: number) => {
        if (found.has(pid)) return;
        found.add(pid);
        for (const child of children.get(pid) ?? []) visit(child);
      };
      for (const pid of pids) visit(pid);
      return [...found];
    }),
  );

/** The herdr pane whose foreground process is this checkout's server. */
const serverPane = Effect.gen(function* () {
  if (!(yield* Herdr.running)) return Option.none<Herdr.Pane>();
  const hosting = yield* Effect.forEach(
    yield* Herdr.listPanes,
    (pane) =>
      Herdr.processInfo(pane.pane_id).pipe(
        Effect.map(({ processes }) =>
          processes.some(
            (candidate) =>
              isServerCommand(candidate.argv.join(" ")) &&
              (candidate.cwd === undefined || candidate.cwd === ROOT),
          )
            ? [pane]
            : [],
        ),
        Effect.orElseSucceed((): Herdr.Pane[] => []),
      ),
    { concurrency: 4 },
  );
  return Array.head(hosting.flat());
}).pipe(Effect.orElseSucceed(() => Option.none<Herdr.Pane>()));

/** The server's processes and, in herdr, the pane it runs in. */
export const findServer = Effect.all({ pids: serverPids, pane: serverPane });
export type FoundServer = Effect.Success<typeof findServer>;

export const describeServer = (found: FoundServer) =>
  Option.match(found.pane, {
    onSome: (pane) => `herdr pane ${pane.pane_id}`,
    onNone: () =>
      found.pids.length > 0
        ? `pid ${found.pids.join(", ")} (background, or a terminal outside herdr)`
        : "not running",
  });

const signal = (pid: number, sig: NodeJS.Signals | 0) =>
  Effect.try(() => process.kill(pid, sig)).pipe(
    Effect.option,
    Effect.map(Option.isSome),
  );

/**
 * Runs `effect` holding `.logs/dev.lock`, so parallel agents cannot start two servers or stop one
 * while another starts it. The lock holds the holder's pid; a lock whose holder is gone is taken
 * over.
 */
export const withLock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(path.join(ROOT, ".logs"), { recursive: true });
      const holder = yield* fs.readFileString(path.join(ROOT, LOCK)).pipe(
        Effect.map((text) =>
          Option.filter(
            Result.getSuccess(decodePid(text.trim())),
            (pid) => pid !== process.pid,
          ),
        ),
        Effect.orElseSucceed(() => Option.none<number>()),
      );
      if (Option.isSome(holder) && (yield* signal(holder.value, 0)))
        return yield* fail(
          `another dev command (pid ${String(holder.value)}) holds ${LOCK}; wait for it to finish`,
        );
      yield* fs.writeFileString(path.join(ROOT, LOCK), String(process.pid));
    }),
    () => effect,
    () =>
      FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) =>
          fs.remove(path.join(ROOT, LOCK), { force: true }),
        ),
        Effect.ignore,
      ),
  );

/**
 * Stops the server wherever it runs. In a pane it presses Ctrl-C, leaving the pane at its prompt.
 * Otherwise, or when the pane ignores Ctrl-C, it sends SIGTERM to the server's processes, their
 * descendants and whatever listens on the port, then waits for all of them to be gone.
 */
export const stopServer = Effect.gen(function* () {
  const found = yield* findServer;
  if (found.pids.length === 0 && (yield* portListeners).length === 0) {
    yield* Console.log("no dev server running");
    return;
  }
  const remaining = Effect.all([serverPids, portListeners]);
  const stopped = remaining.pipe(
    Effect.map(([pids, ports]) => pids.length === 0 && ports.length === 0),
  );
  const terminate = remaining.pipe(
    Effect.flatMap(([pids, ports]) => withDescendants([...pids, ...ports])),
    Effect.flatMap((pids) =>
      Effect.forEach(pids, (pid) => signal(pid, "SIGTERM"), { discard: true }),
    ),
  );
  if (Option.isSome(found.pane)) {
    yield* Herdr.sendKeys(found.pane.value.pane_id, "ctrl+c");
    if (!(yield* waitUntil(stopped, STOP_TIMEOUT, Duration.millis(250))))
      yield* terminate;
  } else yield* terminate;
  if (!(yield* waitUntil(stopped, STOP_TIMEOUT, Duration.millis(250))))
    return yield* fail(
      `port ${String(PORT)} is still held after SIGTERM; check with lsof -i :${String(PORT)}`,
    );
  yield* Console.log(`ok    stopped (${describeServer(found)})`);
});

const Placement = {
  Foreground: { _tag: "Foreground" } as const,
  Background: { _tag: "Background" } as const,
  Pane: (paneId: string) => ({ _tag: "Pane", paneId }) as const,
};
type Placement =
  | typeof Placement.Foreground
  | typeof Placement.Background
  | ReturnType<typeof Placement.Pane>;

const isTty = () => process.stdin.isTTY && process.stdout.isTTY;

const gitOutput = (args: readonly string[]) =>
  runCommand("git", args).pipe(Effect.map((output) => output.trim()));

/**
 * The workspace herdr has open on this checkout, opened if needed. A linked worktree's workspace is
 * grouped under the main checkout's, so that one is opened first.
 */
const checkoutWorkspace = Effect.gen(function* () {
  const open = yield* Herdr.checkoutWorkspace(ROOT);
  if (Option.isSome(open)) return open.value;
  const [gitDir, commonDir] = yield* Effect.all([
    gitOutput(["rev-parse", "--path-format=absolute", "--git-dir"]),
    gitOutput(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  const openMain = (checkout: string) =>
    Herdr.openMainCheckout(checkout, path.basename(checkout)).pipe(
      Effect.tap(() =>
        Console.log(`ok    opened herdr workspace ${path.basename(checkout)}`),
      ),
    );
  if (gitDir === commonDir) return yield* openMain(ROOT);
  const mainCheckout = path.dirname(commonDir);
  const mainWorkspaceId = yield* Herdr.checkoutWorkspace(mainCheckout).pipe(
    Effect.flatMap(
      Option.match({
        onSome: Effect.succeed,
        onNone: () => openMain(mainCheckout),
      }),
    ),
  );
  const label = yield* gitOutput(["branch", "--show-current"]);
  yield* Herdr.openLinkedWorktree({ mainWorkspaceId, path: ROOT, label });
  yield* Console.log(`ok    opened herdr workspace ${label}`);
  return yield* Herdr.checkoutWorkspace(ROOT).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.mapError(() => fail(`herdr opened no workspace on ${ROOT}`)),
  );
});

/** An idle pane of `tabId` in layout order, or a new split. */
const idlePaneIn = Effect.fn("Server.idlePaneIn")(function* (tabId: string) {
  const first = yield* Effect.fromOption(
    Array.findFirst(yield* Herdr.listPanes, (pane) => pane.tab_id === tabId),
  ).pipe(Effect.mapError(() => fail(`the "${TAB}" tab has no panes`)));
  const ordered = yield* Herdr.panesInLayoutOrder(first.pane_id);
  const idle = yield* Effect.findFirst(ordered, (pane) =>
    Herdr.processInfo(pane).pipe(Effect.map(({ idle }) => idle)),
  );
  return yield* Option.match(idle, {
    onSome: Effect.succeed,
    onNone: () => Herdr.splitPane(ordered[0] ?? first.pane_id, ROOT),
  });
});

/**
 * Where a new server runs; the first rule that applies wins:
 *
 * 1. With herdr running, in the checkout's workspace (opened if needed), in its `dev` tab: the
 *    caller's terminal when a person typed the command in that tab; otherwise an idle pane of the
 *    tab, a new split when none is idle, or a new tab. It never types into a busy pane.
 * 2. Without herdr, typed by a person: the caller's terminal, in the foreground.
 * 3. Otherwise: a detached background process.
 *
 * herdr is asked whether it runs (`herdr status`), never `HERDR_ENV`: agents outside herdr can
 * still drive it over its socket.
 */
const placeServer = Effect.gen(function* () {
  if (!(yield* Herdr.running))
    return isTty() ? Placement.Foreground : Placement.Background;
  const workspaceId = yield* checkoutWorkspace;
  const tab = Array.findFirst(
    yield* Herdr.listTabs(workspaceId),
    (candidate) => candidate.label === TAB,
  );
  if (
    isTty() &&
    Option.isSome(tab) &&
    Option.contains(Herdr.callerTabId(), tab.value.tab_id)
  )
    return Placement.Foreground;
  return Placement.Pane(
    yield* Option.match(tab, {
      onNone: () => Herdr.createTab({ workspaceId, cwd: ROOT, label: TAB }),
      onSome: (found) => idlePaneIn(found.tab_id),
    }),
  );
});

const shellQuote = (value: string) =>
  `'${value.replaceAll("'", String.raw`'\''`)}'`;

const runServer = (options: ChildProcess.CommandOptions) =>
  ChildProcess.make("vp", ["run", SCRIPT], { cwd: ROOT, ...options });

/**
 * Starts the server where {@link placeServer} says. A foreground start returns the handle of
 * `vp run dev:server`, which owns the caller's terminal until it exits; the other placements
 * return once the server is launched and outlive the command.
 */
const launchServer = Effect.fn("Server.launchServer")(function* (
  placement: Placement,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Match.valueTags(placement, {
    Pane: ({ paneId }) =>
      Effect.gen(function* () {
        yield* waitUntil(
          Herdr.processInfo(paneId).pipe(Effect.map(({ idle }) => idle)),
          Duration.seconds(10),
          Duration.millis(250),
        );
        yield* Herdr.runInPane(
          paneId,
          `cd ${shellQuote(ROOT)} && vp run ${SCRIPT}`,
        );
        yield* Console.log(
          `ok    started in herdr tab "${TAB}" (pane ${paneId})`,
        );
        return Option.none<ChildProcessSpawner.ChildProcessHandle>();
      }),
    Background: () =>
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          runServer({
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
          }),
        );
        // Unreferenced, the process survives this command's scope closing.
        yield* handle.unref;
        yield* Console.log(
          `ok    started in the background (pid ${String(handle.pid)})`,
        );
        return Option.none<ChildProcessSpawner.ChildProcessHandle>();
      }),
    Foreground: () =>
      spawner
        .spawn(
          runServer({
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            detached: false,
          }),
        )
        .pipe(Effect.map(Option.some)),
  });
});

/** The tail of the server's log, `lines` long. */
export const logTail = (lines: number) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(path.join(ROOT, LOG))),
    Effect.map((text) =>
      text
        .split("\n")
        .slice(-lines - 1)
        .join("\n"),
    ),
    Effect.orElseSucceed(() => `(no ${LOG})`),
  );

/** Waits for an answer; on timeout fails with the log's tail, where the startup error is. */
const waitAnswering = waitUntil(
  answering,
  START_TIMEOUT,
  Duration.millis(500),
).pipe(
  Effect.flatMap((ready) =>
    ready
      ? Effect.void
      : logTail(40).pipe(
          Effect.flatMap((tail) =>
            fail(
              `no answer on ${SERVER_URL} after ${String(Duration.toSeconds(START_TIMEOUT))}s\n--- ${LOG} ---\n${tail}\n---`,
            ),
          ),
        ),
  ),
);

const summarize = (where: string) =>
  Console.log(
    ["", `server: ${where}`, `url:    ${SERVER_URL}`, `logs:   ${LOG}`].join(
      "\n",
    ),
  );

/**
 * Starts the server, or adopts the one running: a server already serving this checkout, found by
 * process and working directory ({@link findServer}), is left running whoever started it. A
 * process of another checkout or program holding the port is refused. Otherwise the server starts
 * where {@link placeServer} says. The whole start holds the lock ({@link withLock}); a foreground
 * server is waited on after the lock is released, so an agent can adopt it.
 */
export const startServer = Effect.gen(function* () {
  const foreground = yield* withLock(
    Effect.gen(function* () {
      const found = yield* findServer;
      if (found.pids.length > 0) {
        yield* Console.log(
          `ok    adopted the running server: ${describeServer(found)}`,
        );
        yield* waitAnswering;
        yield* summarize(describeServer(found));
        return Option.none<ChildProcessSpawner.ChildProcessHandle>();
      }
      if ((yield* portListeners).length > 0)
        return yield* fail(
          `port ${String(PORT)} is held by another process: lsof -nP -iTCP:${String(PORT)} -sTCP:LISTEN`,
        );
      const placement = yield* placeServer;
      const handle = yield* launchServer(placement);
      if (Option.isSome(handle)) return handle;
      yield* waitAnswering;
      yield* summarize(
        Match.valueTags(placement, {
          Pane: ({ paneId }) => `herdr tab "${TAB}" (pane ${paneId})`,
          Background: () => "background",
          Foreground: () => "this terminal",
        }),
      );
      return Option.none<ChildProcessSpawner.ChildProcessHandle>();
    }),
  );
  if (Option.isSome(foreground)) {
    yield* waitAnswering.pipe(
      Effect.flatMap(() => summarize("this terminal")),
      Effect.catch((error) => Console.error(`dev: ${error.message}`)),
      Effect.forkChild,
    );
    yield* foreground.value.exitCode;
  }
}).pipe(Effect.scoped);
