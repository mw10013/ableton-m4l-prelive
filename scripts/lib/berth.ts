/**
 * This checkout's dev port, leased from berth, the machine-wide tool that gives each checkout its
 * own ports (`berth.json` declares the one role, `web`). The lease is the port's only source, so
 * the main checkout and every worktree run side by side. `berth acquire` is idempotent and takes
 * about half a second, so a command asks once and passes the port on.
 *
 * @see ~/projects/tools/docs/berth.md
 * @module
 */
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { fileURLToPath } from "node:url";

export class BerthError extends Schema.TaggedError<BerthError>()("BerthError", {
  message: Schema.String,
}) {}

const Port = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 65_535 }),
);

const AcquireOutput = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ ports: Schema.Struct({ web: Port }) }),
    Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
  ]),
);

/** The checkout's root, where berth finds `berth.json`. */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const notRun = new BerthError({
  message:
    "berth did not run: install its shim, ~/.local/bin/berth running `vpx ~/projects/tools/berth.ts`",
});

/** `berth acquire dev`'s `web` port, leased on first use. berth's own lines go to stderr. */
export const webPort = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner
    .spawn(
      ChildProcess.make("berth", ["acquire", "dev"], {
        cwd: ROOT,
        stdin: "ignore",
        stderr: "inherit",
      }),
    )
    .pipe(Effect.mapError(() => notRun));
  const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout)).pipe(
    Effect.mapError(() => notRun),
  );
  yield* handle.exitCode.pipe(Effect.mapError(() => notRun));
  const output = yield* Schema.decodeUnknownEffect(AcquireOutput)(stdout).pipe(
    Effect.mapError(
      () =>
        new BerthError({
          message: "berth acquire dev printed no lease; its stderr says why",
        }),
    ),
  );
  return "error" in output
    ? yield* new BerthError({ message: output.error.message })
    : output.ports.web;
}).pipe(Effect.scoped);
