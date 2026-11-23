#!/usr/bin/env vpx
/**
 * `vp run project:new <Name>`: starts `projects/<Name> Project/<Name>.als` from
 * `projects/Seed Project/Seed.als`, opens it in Live, and waits until LiveQL answers
 * from it. The Seed's device reference is relative to its Project folder, which sits
 * at the same depth, so the copy needs no rewrite.
 */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schedule from "effect/Schedule";

import { LiveQL } from "#web/server/LiveQL.ts";

const PROJECTS_DIR = "projects";
const SEED_SET = "projects/Seed Project/Seed.als";
const LIVE_APP = "Ableton Live 12 Suite";

class UsageError extends Data.TaggedError("UsageError")<{
  readonly message: string;
}> {}

class ProjectExistsError extends Data.TaggedError("ProjectExistsError")<{
  readonly project: string;
}> {
  override get message() {
    return `${this.project} already exists`;
  }
}

class SetNotOpenError extends Data.TaggedError("SetNotOpenError")<{
  readonly expected: string;
  readonly actual: string;
}> {
  override get message() {
    return `Live has ${this.actual || "an unsaved Set"} open, not ${this.expected}`;
  }
}

const parseName = (arg: string | undefined) =>
  arg === undefined || arg.trim() === "" || arg.includes("/")
    ? Effect.fail(
        new UsageError({ message: 'usage: vp run project:new "<Name>"' }),
      )
    : Effect.succeed(arg.trim());

const newProject = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const name = yield* parseName(process.argv[2]);
  const project = path.resolve(PROJECTS_DIR, `${name} Project`);
  const set = path.join(project, `${name}.als`);

  if (yield* fs.exists(project)) {
    return yield* new ProjectExistsError({ project });
  }
  yield* fs.makeDirectory(path.join(project, "Ableton Project Info"), {
    recursive: true,
  });
  yield* fs.copyFile(SEED_SET, set);
  yield* Console.log(`Created ${set}`);

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner.exitCode(ChildProcess.make("open", ["-a", LIVE_APP, set]));
  yield* Console.log(
    "Opening in Live; answer its save prompt if the current Set has changes",
  );

  const liveql = yield* LiveQL;
  yield* liveql
    .execute((client) => client.SetFile())
    .pipe(
      Effect.flatMap(({ live_set }) =>
        live_set.file_path === set
          ? Effect.void
          : Effect.fail(
              new SetNotOpenError({
                expected: set,
                actual: live_set.file_path,
              }),
            ),
      ),
      Effect.retry({ schedule: Schedule.spaced("1 second"), times: 60 }),
    );
  yield* Console.log(`LiveQL answers from ${set}`);
});

newProject.pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, LiveQL.layerConfig)),
  NodeRuntime.runMain,
);
