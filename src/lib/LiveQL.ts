import { Config, Context, Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

export class LiveQLError extends Schema.TaggedError<LiveQLError>()(
  "LiveQLError",
  {
    reason: Schema.Literals(["transport", "graphql", "decode"]),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

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
    ) => Effect.Effect<A, LiveQLError>;
  }
>()("app/LiveQL") {
  static readonly layerNoDeps: Layer.Layer<
    LiveQL,
    never,
    HttpClient.HttpClient
  > = Layer.effect(
    LiveQL,
    Effect.gen(function* () {
      const endpoint = yield* Config.string("LIVEQL_ENDPOINT").pipe(
        Config.withDefault("http://localhost:4000/graphql"),
        Effect.orDie,
      );
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.acceptJson),
        HttpClient.filterStatusOk,
      );
      const gqlDecode = Effect.fn("LiveQL.gqlDecode")(function* <A>(
        schema: Schema.ConstraintDecoder<A>,
        query: string,
        variables?: Record<string, unknown>,
      ) {
        const { data, errors } = yield* HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.bodyJsonUnsafe({ query, variables }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(GqlEnvelope)),
          Effect.timeout("10 seconds"),
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
  );

  static readonly layer = Layer.provide(
    this.layerNoDeps,
    FetchHttpClient.layer,
  );
}
