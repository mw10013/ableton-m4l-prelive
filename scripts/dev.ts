#!/usr/bin/env vpx
/**
 * `vp run dev | dev:stop | dev:status | dev:logs`: one command that an agent and a person both use
 * to get this checkout's dev server running, and to find it again. How a running one is adopted,
 * and the lock, are {@link startServer}'s rules; its output always goes to `.logs/dev/current`.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import process from "node:process";

import { heldWebPort, webPort } from "./lib/berth.ts";
import { runCommand } from "./lib/command.ts";
import {
  answering,
  describeServer,
  findServer,
  followLog,
  LOG,
  logTail,
  portListeners,
  startServer,
  stopServer,
  urlOf,
  withLock,
} from "./lib/server.ts";

const toUserError = (error: { readonly message: string }) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

const startCommand = Command.make("start", {}, () =>
  webPort.pipe(
    Effect.flatMap((port) => startServer(port)),
    Effect.mapError(toUserError),
  ),
).pipe(
  Command.withDescription(
    "Start the dev server, or adopt the one already running.",
  ),
);

const stopCommand = Command.make("stop", {}, () =>
  Effect.gen(function* () {
    const port = yield* heldWebPort;
    if (Option.isNone(port))
      return yield* Console.log(
        "no dev lease, so no dev server of this checkout runs",
      );
    yield* withLock(stopServer(port.value));
  }).pipe(Effect.mapError(toUserError)),
).pipe(
  Command.withDescription(
    "Stop the dev server. A checkout without a dev lease has none, and gets no lease.",
  ),
);

const openCommand = Command.make("open", {}, () =>
  webPort.pipe(
    Effect.flatMap((port) =>
      startServer(port, runCommand("open", [urlOf(port)])),
    ),
    Effect.mapError(toUserError),
  ),
).pipe(
  Command.withDescription(
    "Start or adopt the dev server, then open it in the default browser.",
  ),
);

const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const port = yield* webPort.pipe(Effect.mapError(toUserError));
    const pids = yield* findServer;
    const listening = (yield* portListeners(port)).length > 0;
    const serving = listening && (yield* answering(port));
    const healthy = pids.length > 0 && serving;
    yield* Console.log(
      [
        `healthy: ${healthy ? "yes" : "no"}`,
        `server:  ${describeServer(pids)}`,
        `port:    ${String(port)} (${listening ? "listening" : "not listening"}, ${serving ? "answering" : "not answering"})`,
        `url:     ${urlOf(port)}`,
        `logs:    ${LOG}`,
      ].join("\n"),
    );
    if (!healthy) yield* Effect.sync(() => (process.exitCode = 1));
  }),
).pipe(
  Command.withDescription(
    "Report where the server runs and whether it answers. Read-only; exit code 1 when unhealthy.",
  ),
);

const logsCommand = Command.make(
  "logs",
  {
    lines: Flag.Int("lines").pipe(
      Flag.withDescription("Lines from the end of the log"),
      Flag.withDefault(80),
    ),
    follow: Flag.Boolean("follow").pipe(
      Flag.withDescription(
        "Keep printing new lines, through log rotation, until interrupted",
      ),
      Flag.withDefault(false),
    ),
  },
  ({ lines, follow }) =>
    Effect.gen(function* () {
      if (follow) return yield* followLog(lines);
      yield* Console.log(yield* logTail(lines));
    }),
).pipe(
  Command.withDescription(
    `Print the tail of ${LOG}; with --follow, keep following it.`,
  ),
);

Command.make("dev").pipe(
  Command.withDescription(
    [
      "Run this checkout's dev server (Vite behind s6-log), the same for an agent and a person.",
      "start adopts a server already running for this checkout, or starts one detached, waits until it answers, and exits; the server keeps running until dev:stop.",
      `Output goes to ${LOG}; dev:logs --follow follows it.`,
    ].join("\n"),
  ),
  Command.withSubcommands([
    startCommand,
    openCommand,
    stopCommand,
    statusCommand,
    logsCommand,
  ]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
