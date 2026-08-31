import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import * as Domain from "@/lib/Domain";
import { LilyPondRenderer } from "@/lib/lilypond/renderer";
import { runServerFn } from "@/lib/runtime";

export const renderLilyPondSvg = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ notes: Schema.Array(Domain.Note) }),
    ),
  )
  .handler(async ({ data }) => {
    const svg = await runServerFn(
      Effect.gen(function* () {
        const renderer = yield* LilyPondRenderer;
        return new TextDecoder().decode(
          yield* renderer.renderToSvg(data.notes),
        );
      }),
    );
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  });
