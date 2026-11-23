import type * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as GraphQLClient from "effect/graphql/GraphQLClient";
import type * as GraphQLClientError from "effect/graphql/GraphQLClientError";
import * as GraphQLProtocol from "effect/graphql/GraphQLProtocol";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";

import { LiveQLError } from "#web/errors.ts";

import { LiveSetGraphQLGroup } from "./liveql/liveSet.graphql.ts";

const makeClient = GraphQLClient.make(LiveSetGraphQLGroup);

type Client = Effect.Success<typeof makeClient>;

const TRANSPORT_MESSAGE =
  "LiveQL unreachable — is Live running with the liveql device started?";

const toLiveQLError = (
  error: GraphQLClientError.GraphQLClientError | Cause.TimeoutError,
): Effect.Effect<never, LiveQLError> =>
  error._tag === "TimeoutError"
    ? Effect.fail(
        new LiveQLError({
          reason: "transport",
          message: TRANSPORT_MESSAGE,
          cause: error,
        }),
      )
    : Match.value(error.reason).pipe(
        Match.tagsExhaustive({
          TransportError: (reason) =>
            Effect.fail(
              new LiveQLError({
                reason: "transport",
                message: TRANSPORT_MESSAGE,
                cause: reason,
              }),
            ),
          ResponseError: (reason) =>
            Effect.fail(
              new LiveQLError({
                reason: "graphql",
                message: reason.message,
                cause: reason.errors,
              }),
            ),
          DecodeError: (reason) =>
            Effect.fail(
              new LiveQLError({
                reason: "decode",
                message: "LiveQL response validation failed",
                cause: reason,
              }),
            ),
          EncodeError: () => Effect.die(error),
          PaginationError: () => Effect.die(error),
        }),
      );

export class LiveQL extends Context.Service<
  LiveQL,
  {
    readonly execute: <A>(
      call: (
        client: Client,
      ) => Effect.Effect<A, GraphQLClientError.GraphQLClientError>,
      options?: { readonly timeout?: Duration.Input },
    ) => Effect.Effect<A, LiveQLError>;
  }
>()("app/LiveQL") {
  static readonly layerConfig: Layer.Layer<LiveQL> = Layer.effect(
    LiveQL,
    Effect.gen(function* () {
      const client = yield* makeClient;
      return LiveQL.of({
        execute: (call, options) =>
          call(client).pipe(
            Effect.timeout(options?.timeout ?? "10 seconds"),
            Effect.catch(toLiveQLError),
          ),
      });
    }),
  ).pipe(
    Layer.provide(
      Layer.unwrap(
        Config.String("LIVEQL_ENDPOINT").pipe(
          Config.withDefault("http://localhost:5100/graphql"),
          Effect.orDie,
          Effect.map((url) => GraphQLProtocol.layerHttp({ url })),
        ),
      ),
    ),
    Layer.provide(FetchHttpClient.layer),
  );
}
