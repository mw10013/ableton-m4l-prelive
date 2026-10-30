#!/usr/bin/env vpx
/**
 * `vp run dev | dev:stop | dev:status | dev:logs`: one command that an agent and a person both use
 * to get this checkout's dev server running, and to find it again. Where it runs, how a running one
 * is adopted, and the lock are {@link startServer}'s rules; its output always goes to
 * `.logs/dev/current`.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import process from "node:process";

import {
  answering,
  describeServer,
  findServer,
  LOG,
  logTail,
  PORT,
  portListeners,
  SERVER_URL,
  startServer,
  stopServer,
  withLock,
} from "./lib/server.ts";

const toUserError = (error: { readonly message: string }) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

const startCommand = Command.make("start", {}, () =>
  startServer.pipe(Effect.mapError(toUserError)),
).pipe(
  Command.withDescription(
    "Start the dev server, or adopt the one already running.",
  ),
);

const stopCommand = Command.make("stop", {}, () =>
  withLock(stopServer).pipe(Effect.mapError(toUserError)),
).pipe(Command.withDescription("Stop the dev server wherever it runs."));

const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const found = yield* findServer;
    const listening = (yield* portListeners).length > 0;
    const serving = listening && (yield* answering);
    const healthy = found.pids.length > 0 && serving;
    yield* Console.log(
      [
        `healthy: ${healthy ? "yes" : "no"}`,
        `server:  ${describeServer(found)}`,
        `port:    ${String(PORT)} (${listening ? "listening" : "not listening"}, ${serving ? "answering" : "not answering"})`,
        `url:     ${SERVER_URL}`,
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
  },
  ({ lines }) => logTail(lines).pipe(Effect.flatMap(Console.log)),
).pipe(Command.withDescription(`Print the tail of ${LOG}.`));

Command.make("dev").pipe(
  Command.withDescription(
    [
      "Run this checkout's dev server (vp run dev:server: Vite behind s6-log) for an agent or a person.",
      "Where it runs, first match wins:",
      "  1. a server already running for this checkout is adopted;",
      '  2. with herdr running: the checkout\'s workspace, tab "dev" (opened if needed);',
      "     typed by a person in that tab, this terminal; otherwise an idle pane there;",
      "  3. without herdr, typed in a terminal: this terminal;",
      "  4. otherwise: in the background.",
      `Output always goes to ${LOG}.`,
    ].join("\n"),
  ),
  Command.withSubcommands([
    startCommand,
    stopCommand,
    statusCommand,
    logsCommand,
  ]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
