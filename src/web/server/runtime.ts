import type * as Effect from "effect/Effect";

import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

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

export const runServerFn = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<typeof appLayer>>,
): Promise<A> =>
  runtime
    .runPromiseExit(effect)
    .then((exit) =>
      Exit.isSuccess(exit)
        ? exit.value
        : Promise.reject(new Error(causeToErrorMessage(exit.cause))),
    );

const dispose = () => void runtime.dispose();

process.once("SIGINT", dispose);
process.once("SIGTERM", dispose);
