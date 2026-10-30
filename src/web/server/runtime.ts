import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";

import { isBoundaryError } from "#web/errors.ts";

import { LilyPondRenderer } from "./lilypond/renderer.ts";
import { LiveQL } from "./LiveQL.ts";

const appLayer = Layer.provideMerge(
  Layer.mergeAll(LilyPondRenderer.layer, LiveQL.layerConfig),
  ConfigProvider.layer(ConfigProvider.fromEnv()),
);

export const runtime = ManagedRuntime.make(appLayer);

const renderCauseValue = (value: unknown): string => {
  try {
    return JSON.stringify(value)?.slice(0, 2000) ?? String(value);
  } catch {
    return String(value);
  }
};

const formatErrorMessage = (error: Error): string => {
  const message =
    error.name && error.name !== "Error"
      ? `${error.name}: ${error.message}`
      : error.message;
  if (error.cause instanceof Error) {
    return `${message}\n[cause]: ${formatErrorMessage(error.cause)}`;
  }
  if (error.cause === undefined || error.cause === null) return message;
  return `${message}\n[cause]: ${renderCauseValue(error.cause)}`;
};

export const causeToErrorMessage = <E>(cause: Cause.Cause<E>): string =>
  Cause.prettyErrors(cause).map(formatErrorMessage).join("\n");

/**
 * Runs a server function's effect. A typed failure the browser knows ({@link isBoundaryError})
 * is rethrown as itself, for Start's serialization adapters to carry over; anything else, a defect
 * or an unknown failure, becomes a plain `Error` with the rendered cause. Every failure's full cause
 * is logged here, since the browser never receives it.
 */
export const runServerFn = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<typeof appLayer>>,
): Promise<A> =>
  runtime
    .runPromiseExit(
      effect.pipe(
        Effect.tapCause((cause) =>
          Effect.logError("runServerFn: failed", cause),
        ),
      ),
    )
    .then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      const failure = Cause.findErrorOption(exit.cause);
      throw Option.isSome(failure) && isBoundaryError(failure.value)
        ? failure.value
        : new Error(causeToErrorMessage(exit.cause));
    });

const dispose = () => void runtime.dispose();

process.once("SIGINT", dispose);
process.once("SIGTERM", dispose);
