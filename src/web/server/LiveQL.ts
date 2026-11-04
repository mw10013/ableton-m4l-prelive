import * as Config from "effect/Config";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { LiveQLError } from "#web/errors.ts";

const GqlEnvelope = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.String })),
  ),
});

export class LiveQL extends Context.Service<
  LiveQL,
  {
    readonly gqlDecode: <A>(
      schema: Schema.ConstraintDecoder<A>,
      query: string,
      variables?: Record<string, unknown>,
      options?: { readonly timeout?: Duration.Input },
    ) => Effect.Effect<A, LiveQLError>;
  }
>()("app/LiveQL") {
  static readonly layerConfig: Layer.Layer<LiveQL> = Layer.effect(
    LiveQL,
    Effect.gen(function* () {
      const endpoint = yield* Config.String("LIVEQL_ENDPOINT").pipe(
        Config.withDefault("http://localhost:5100/graphql"),
        Effect.orDie,
      );
      // No filterStatusOk: a GraphQL server answers a malformed document with
      // 400 and the reason in the errors array. Filtering on status would turn
      // that into a transport failure and throw the reason away, reporting an
      // unreachable server for a request the server in fact answered.
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.acceptJson),
      );
      const gqlDecode = Effect.fn("LiveQL.gqlDecode")(function* <A>(
        schema: Schema.ConstraintDecoder<A>,
        query: string,
        variables?: Record<string, unknown>,
        options?: { readonly timeout?: Duration.Input },
      ) {
        const { data, errors } = yield* HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.bodyJsonUnsafe({ query, variables }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(GqlEnvelope)),
          Effect.timeout(options?.timeout ?? "10 seconds"),
          Effect.mapError(
            (cause) =>
              new LiveQLError({
                reason: "transport",
                message:
                  "LiveQL unreachable — is Live running with the liveql device started?",
                cause,
              }),
          ),
        );
        if (errors !== undefined && errors.length > 0) {
          return yield* Effect.fail(
            new LiveQLError({
              reason: "graphql",
              message: errors.map((e) => e.message).join("; "),
              cause: errors,
            }),
          );
        }
        return yield* Schema.decodeUnknownEffect(schema)(data).pipe(
          Effect.mapError(
            (cause) =>
              new LiveQLError({
                reason: "decode",
                message: "LiveQL response validation failed",
                cause,
              }),
          ),
        );
      });
      return LiveQL.of({ gqlDecode });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
