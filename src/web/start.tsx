import { createStart } from "@tanstack/react-start";

import { lilyPondErrorAdapter, liveQLErrorAdapter } from "./errors.ts";

export const startInstance = createStart(() => ({
  serializationAdapters: [liveQLErrorAdapter, lilyPondErrorAdapter],
}));
