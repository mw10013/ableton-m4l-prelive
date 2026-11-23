import { generate } from "@effect/graphql-generator/Generator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import config from "#root/graphql.config.ts";

const ROOT = new URL("../..", import.meta.url).pathname;

describe("LiveQL documents", () => {
  it.effect("are valid against the pinned schema and generated", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { files, deletes, diagnostics } = yield* generate(config, {
        cwd: ROOT,
      });
      assert.deepStrictEqual(
        diagnostics
          .filter(({ severity }) => severity === "error")
          .map(
            ({ path, line, column, message }) =>
              `${path}:${String(line)}:${String(column)}: ${message}`,
          ),
        [],
      );
      const stale = yield* Effect.filter(files, ({ path, contents }) =>
        fs.readFileString(path).pipe(
          Effect.map((onDisk) => onDisk !== contents),
          Effect.orElseSucceed(() => true),
        ),
      );
      assert.deepStrictEqual(
        [...stale.map(({ path }) => path), ...deletes],
        [],
        "out of date: run `vp run liveql:codegen`",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
