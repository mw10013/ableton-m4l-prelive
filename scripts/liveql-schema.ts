#!/usr/bin/env vpx
/**
 * `vp run liveql:schema [ref]`: writes LiveQL's committed `schema.graphql` at `ref` (a branch, tag
 * or commit of ableton-m4l-liveql, default `main`) to `src/web/server/liveql/liveql.graphql`, the
 * schema prelive's documents are generated and checked against. The first line pins the commit.
 */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";

const REPO = "mw10013/ableton-m4l-liveql";
const OUT_PATH = "src/web/server/liveql/liveql.graphql";

const writeSchema = Effect.gen(function* () {
  const ref = process.argv[2] ?? "main";
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const sha = yield* HttpClientRequest.get(
    `https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`,
  ).pipe(
    HttpClientRequest.accept("application/vnd.github.sha"),
    client.execute,
    Effect.flatMap((response) => response.text),
    Effect.map((text) => text.trim()),
  );
  const sdl = yield* HttpClientRequest.get(
    `https://raw.githubusercontent.com/${REPO}/${sha}/schema.graphql`,
  ).pipe(
    client.execute,
    Effect.flatMap((response) => response.text),
  );
  yield* (yield* FileSystem.FileSystem).writeFileString(
    OUT_PATH,
    `# ableton-m4l-liveql ${sha}\n${sdl}`,
  );
  yield* Console.log(`Wrote ${OUT_PATH} from ${REPO}@${sha} (${ref})`);
});

writeSchema.pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);
