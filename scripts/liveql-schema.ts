#!/usr/bin/env vpx
/**
 * `vp run liveql:schema`: introspects a running liveql server and writes its schema as SDL to
 * `refs/liveql-schema.graphql`, the reference for the GraphQL documents in `src/web/server`.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  buildClientSchema,
  getIntrospectionQuery,
  type IntrospectionQuery,
  printSchema,
} from "graphql";

const OUT_PATH = "refs/liveql-schema.graphql";

class IntrospectionError extends Schema.TaggedError<IntrospectionError>()(
  "IntrospectionError",
  { message: Schema.String },
) {}

const Response = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.String })),
  ),
});

const introspect = Effect.gen(function* () {
  const endpoint = yield* Config.String("LIVEQL_ENDPOINT").pipe(
    Config.withDefault("http://localhost:4000/graphql"),
  );
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const { data, errors } = yield* HttpClientRequest.post(endpoint).pipe(
    HttpClientRequest.bodyJsonUnsafe({ query: getIntrospectionQuery() }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)),
  );
  if (errors !== undefined && errors.length > 0)
    return yield* new IntrospectionError({
      message: errors.map((error) => error.message).join("; "),
    });
  if (data === undefined)
    return yield* new IntrospectionError({
      message: "Introspection response missing data",
    });
  // graphql-js validates the introspection shape itself and throws on a mismatch.
  const sdl = yield* Effect.try({
    try: () => printSchema(buildClientSchema(data as IntrospectionQuery)),
    catch: (cause) => new IntrospectionError({ message: String(cause) }),
  });
  yield* (yield* FileSystem.FileSystem).writeFileString(OUT_PATH, `${sdl}\n`);
  yield* Console.log(
    `Wrote ${OUT_PATH} (${String(sdl.length)} bytes) from ${endpoint}`,
  );
});

introspect.pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);
