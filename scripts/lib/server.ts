/**
 * This checkout's dev server: `scripts/serve.ts` running Vite behind `s6-log`. Here is how it
 * is found, probed, started detached ({@link startServer}) and stopped
 * ({@link stopServer}).
 *
 * @module
 */
import * as Array from "effect/Array";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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

/** This checkout's root, where the server runs and every path below is relative to. */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(
  /\/$/u,
  "",
);

/** The server's address on its leased port (`berth.ts`); `serve.ts` passes `--strictPort` so Vite never drifts. */
export const urlOf = (port: number) => `http://localhost:${String(port)}/`;
export const LOG = ".logs/dev/current";
const LOCK = ".logs/dev.lock";
/** The package script that runs the server in the foreground: `scripts/serve.ts`. */
const SCRIPT = "dev:serve";

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

export const portListeners = (port: number) =>
  runCommand("lsof", [
    "-t",
    `-iTCP:${String(port)}`,
    "-sTCP:LISTEN",
    "-nP",
  ]).pipe(
    Effect.map(pidsFrom),
    Effect.orElseSucceed((): number[] => []),
  );

/** Any HTTP answer counts: the first request after a start waits on Vite's compile. */
export const answering = (port: number) =>
  Effect.tryPromise(() =>
    fetch(urlOf(port), {
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

export const findServer = runCommand("pgrep", ["-f", SERVER_PROCESS]).pipe(
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

export const describeServer = (pids: readonly number[]) =>
  pids.length > 0 ? `pid ${pids.join(", ")}` : "not running";

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
 * Sends SIGTERM to the server's processes, their descendants and whatever listens on the port,
 * then waits for all of them to be gone.
 */
export const stopServer = Effect.fn("Server.stopServer")(function* (
  port: number,
) {
  const remaining = Effect.all([findServer, portListeners(port)]);
  const [pids, listeners] = yield* remaining;
  if (pids.length === 0 && listeners.length === 0) {
    yield* Console.log("no dev server running");
    return;
  }
  yield* withDescendants([...pids, ...listeners]).pipe(
    Effect.flatMap((all) =>
      Effect.forEach(all, (pid) => signal(pid, "SIGTERM"), { discard: true }),
    ),
  );
  const stopped = remaining.pipe(
    Effect.map(([left, ports]) => left.length === 0 && ports.length === 0),
  );
  if (!(yield* waitUntil(stopped, STOP_TIMEOUT, Duration.millis(250))))
    return yield* fail(
      `port ${String(port)} is still held after SIGTERM; check with lsof -i :${String(port)}`,
    );
  yield* Console.log(`ok    stopped (${describeServer(pids)})`);
});

const launchServer = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make("vp", ["run", SCRIPT], {
      cwd: ROOT,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    }),
  );
  // Effect's spawner kills a still-referenced child when the scope closes; unref skips that.
  yield* handle.unref;
  yield* Console.log(`ok    started detached (pid ${String(handle.pid)})`);
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
const waitAnswering = (port: number) =>
  waitUntil(answering(port), START_TIMEOUT, Duration.millis(500)).pipe(
    Effect.flatMap((ready) =>
      ready
        ? Effect.void
        : logTail(40).pipe(
            Effect.flatMap((tail) =>
              fail(
                `no answer on ${urlOf(port)} after ${String(Duration.toSeconds(START_TIMEOUT))}s\n--- ${LOG} ---\n${tail}\n---`,
              ),
            ),
          ),
    ),
  );

/** `s6-log` rotates by renaming `current`; `tail -F` reopens it by name. */
export const followLog = (lines: number) =>
  ChildProcessSpawner.ChildProcessSpawner.pipe(
    Effect.flatMap((spawner) =>
      spawner.exitCode(
        ChildProcess.make(
          "tail",
          ["-F", "-n", String(lines), path.join(ROOT, LOG)],
          {
            stdin: "ignore",
            stdout: "inherit",
            stderr: "inherit",
          },
        ),
      ),
    ),
    Effect.asVoid,
  );

const summarize = (port: number) =>
  findServer.pipe(
    Effect.flatMap((pids) =>
      Console.log(
        [
          "",
          `server: ${describeServer(pids)}`,
          `url:    ${urlOf(port)}`,
          `logs:   ${LOG}`,
        ].join("\n"),
      ),
    ),
  );

/**
 * Starts the server, or adopts the one running: a server already serving this checkout, found by
 * process and working directory ({@link findServer}), is left running whoever started it. A
 * process of another checkout or program holding the port is refused. Otherwise the server starts
 * detached and outlives this command until `dev:stop`. The whole start holds the lock
 * ({@link withLock}). `ready` runs once the server answers (`vp run dev:open` opens the browser).
 */
export const startServer = <
  E extends { readonly message: string } = never,
  R = never,
>(
  port: number,
  ready: Effect.Effect<void, E, R> = Effect.void,
) =>
  withLock(
    Effect.gen(function* () {
      const found = yield* findServer;
      if (found.length > 0)
        yield* Console.log(
          `ok    adopted the running server: ${describeServer(found)}`,
        );
      else if ((yield* portListeners(port)).length > 0)
        return yield* fail(
          `port ${String(port)} is held by another process: lsof -nP -iTCP:${String(port)} -sTCP:LISTEN`,
        );
      else yield* launchServer;
      yield* waitAnswering(port);
      yield* summarize(port);
      yield* ready;
    }),
  ).pipe(Effect.scoped);
