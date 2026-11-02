#!/usr/bin/env vpx
/**
 * `vp run dev:server`: the dev server in the foreground, which `scripts/dev.ts` starts in a herdr
 * pane, the caller's terminal or the background, and which nothing else should run. It is
 * Vite's dev server on this checkout's port from berth (`lib/berth.ts`), `--strictPort` so a held
 * port fails instead of drifting.
 *
 * Vite's whole output goes to `.logs/dev/current` through `s6-log`, between a start line and an
 * exit line, and is echoed to stderr. On SIGTERM or SIGINT it stops Vite, and `s6-log`, in its own
 * process group, writes everything Vite wrote before it stops.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { webPort } from "./lib/berth.ts";
import { runCommand } from "./lib/command.ts";
import { LOG, ROOT } from "./lib/server.ts";

class ServeError extends Schema.TaggedError<ServeError>()("ServeError", {
  message: Schema.String,
}) {}

/** `s6-log`'s rotation: 20 files of 5 MiB at most, 100 MiB in all, an ISO timestamp on each line. */
const S6_LOG_ARGS = [
  "-b",
  "-l",
  "65536",
  "n20",
  "s5242880",
  "S104857600",
  "T",
  `./${path.dirname(LOG)}`,
  "1",
];
/**
 * Vite's own CLI, run directly rather than through `vp dev`: under `vpx` the local `vp` shim keeps
 * Vite as a child, and on a Ctrl-C the shim exits first and orphans Vite, which then holds the log
 * pipe open so the exit marker is never written.
 */
const VITE_CLI = fileURLToPath(
  new URL("dist/vite/bin/vite.js", import.meta.resolve("vite/package.json")),
);
/** How long a stop waits for Vite to exit and `s6-log` to write its last lines. */
const LOGGER_DRAIN = "15 seconds";

const serve = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const port = yield* webPort;
  const run = randomUUID().slice(0, 8);
  const log = (line: string) => runCommand("s6-log", S6_LOG_ARGS, `${line}\n`);

  yield* log(`==== dev start run=${run}`);
  const vite = yield* spawner.spawn(
    ChildProcess.make(
      process.execPath,
      [
        VITE_CLI,
        "dev",
        "--clearScreen",
        "false",
        "--port",
        String(port),
        "--strictPort",
      ],
      {
        cwd: ROOT,
        env: { FORCE_COLOR: undefined, NO_COLOR: "1" },
        extendEnv: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        // In this script's process group, so the herdr pane running it shows Vite in its foreground
        // (how the server's pane is found) and a Ctrl-C there reaches Vite too.
        detached: false,
      },
    ),
  );
  const logger = yield* spawner.spawn(
    ChildProcess.make("s6-log", S6_LOG_ARGS, {
      cwd: ROOT,
      stdin: {
        stream: Stream.merge(vite.stdout, vite.stderr).pipe(
          Stream.tap((chunk) => Effect.sync(() => process.stderr.write(chunk))),
        ),
      },
      stdout: "inherit",
      stderr: "inherit",
      // Its own process group: a Ctrl-C's SIGINT would kill `s6-log` at once, losing Vite's last
      // lines and leaving `current` unfinished. It stops when Vite's output ends.
      detached: true,
    }),
  );
  // A Ctrl-C reaches Vite and this script together, and Vite usually exits first: only the wait
  // for Vite is interruptible, so the exit marker is still written when the interrupt lands after.
  const exitCode = yield* Effect.uninterruptibleMask((restore) =>
    restore(
      Effect.raceFirst(
        vite.exitCode,
        logger.exitCode.pipe(
          Effect.flatMap(
            (code) =>
              new ServeError({
                message: `s6-log exited ${String(code)} while vite dev was running`,
              }),
          ),
        ),
      ),
    ).pipe(
      // Drain before opening a second logger to append the exit marker.
      Effect.onInterrupt(() =>
        vite
          .kill()
          .pipe(
            Effect.andThen(logger.exitCode),
            Effect.andThen(log(`==== dev exit run=${run} interrupted`)),
            Effect.timeout(LOGGER_DRAIN),
            Effect.ignore,
          ),
      ),
      Effect.tap((code) =>
        logger.exitCode.pipe(
          Effect.andThen(log(`==== dev exit run=${run} code=${String(code)}`)),
          Effect.timeout(LOGGER_DRAIN),
          Effect.ignore,
        ),
      ),
    ),
  );
  return yield* new ServeError({
    message: `vite dev exited ${String(exitCode)}`,
  });
}).pipe(Effect.scoped);

serve.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
