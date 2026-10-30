import { createServerFn } from "@tanstack/react-start";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Domain from "#domain/live.ts";
import { runServerFn } from "#web/server/runtime.ts";

import { LilyPondRenderer } from "./renderer.ts";

export const renderLilyPondSvg = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ notes: Schema.Array(Domain.ReplacementNote) }),
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
