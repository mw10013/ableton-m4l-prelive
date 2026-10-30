import { createSerializationAdapter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

export class LiveQLError extends Schema.TaggedError<LiveQLError>()(
  "LiveQLError",
  {
    reason: Schema.Literals(["transport", "graphql", "decode"]),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class LilyPondError extends Schema.TaggedError<LilyPondError>()(
  "LilyPondError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/**
 * Failures that cross from a server function to the browser. Both sides import these classes, and
 * the serialization adapters registered in `start.tsx` carry them over the wire, so a component
 * receives the class it can branch on (`error.reason`) rather than a flattened message. The
 * `cause` stays on the server, where `runServerFn` logs it.
 */
export const isBoundaryError = (
  value: unknown,
): value is LiveQLError | LilyPondError =>
  value instanceof LiveQLError || value instanceof LilyPondError;

export const liveQLErrorAdapter = createSerializationAdapter({
  key: "app/LiveQLError",
  test: (value): value is LiveQLError => value instanceof LiveQLError,
  toSerializable: ({ reason, message }) => ({ reason, message }),
  fromSerializable: ({ reason, message }) =>
    new LiveQLError({ reason, message, cause: undefined }),
});

export const lilyPondErrorAdapter = createSerializationAdapter({
  key: "app/LilyPondError",
  test: (value): value is LilyPondError => value instanceof LilyPondError,
  toSerializable: ({ message }) => ({ message }),
  fromSerializable: ({ message }) =>
    new LilyPondError({ message, cause: undefined }),
});
