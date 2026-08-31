import type { Note } from "@/lib/Domain";

import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";

import { LilyPondRenderer } from "@/lib/lilypond/renderer";
import { runtime } from "@/lib/runtime";

export const renderLilyPondSvg = createServerFn({ method: "POST" })
  .validator((data: { notes: readonly Note[] }) => data)
  .handler(async ({ data }) => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const renderer = yield* LilyPondRenderer;
        const svgBytes = yield* renderer.renderToSvg(data.notes);
        return new TextDecoder().decode(svgBytes);
      }).pipe(Effect.provide(LilyPondRenderer.layer)),
    );
    return new Response(result, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  });
