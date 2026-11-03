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
import * as Option from "effect/Option";
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

const ErrorJson = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});
const LeaseJson = Schema.Struct({ ports: Schema.Struct({ web: Port }) });

const AcquireOutput = Schema.fromJsonString(
  Schema.Union([LeaseJson, ErrorJson]),
);

/** `berth show`: the lease, or null when the checkout holds none. */
const ShowOutput = Schema.fromJsonString(
  Schema.Union([Schema.Struct({ lease: Schema.NullOr(LeaseJson) }), ErrorJson]),
);

/** The checkout's root, where berth finds `berth.json`. */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const notRun = new BerthError({
  message:
    "berth did not run: install its shim, ~/.local/bin/berth running `vpx ~/projects/tools/berth.ts`",
});

/** `berth <args>`'s stdout, run in this checkout. berth's own lines go to stderr. */
const runBerth = (args: readonly string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make("berth", [...args], {
        cwd: ROOT,
        stdin: "ignore",
        stderr: "inherit",
      }),
    );
    const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout));
    yield* handle.exitCode;
    return stdout;
  }).pipe(
    Effect.scoped,
    Effect.mapError(() => notRun),
  );

const noLease = (command: string) =>
  new BerthError({
    message: `berth ${command} dev printed no lease; its stderr says why`,
  });

/** `berth acquire dev`'s `web` port, leased on first use. */
export const webPort = Effect.gen(function* () {
  const output = yield* runBerth(["acquire", "dev"]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(AcquireOutput)),
    Effect.mapError((error) =>
      error._tag === "BerthError" ? error : noLease("acquire"),
    ),
  );
  return "error" in output
    ? yield* new BerthError({ message: output.error.message })
    : output.ports.web;
});

/**
 * `berth show dev`'s `web` port, or none when this checkout holds no lease; never makes one. A
 * stop asks this, so a checkout that `wt rm` tears down is not handed a lease on its way out.
 */
export const heldWebPort = Effect.gen(function* () {
  const output = yield* runBerth(["show", "dev"]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ShowOutput)),
    Effect.mapError((error) =>
      error._tag === "BerthError" ? error : noLease("show"),
    ),
  );
  return "error" in output
    ? yield* new BerthError({ message: output.error.message })
    : Option.map(Option.fromNullOr(output.lease), (lease) => lease.ports.web);
});
