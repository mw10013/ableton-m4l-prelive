import type { ReplacementNote as Note } from "#domain/live.ts";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";

import { quantizeNotes } from "#domain/lilypond/quantizer.ts";
import { notesToLilyPond } from "#domain/lilypond/score.ts";

class LilyPondError extends Schema.TaggedError<LilyPondError>()(
  "LilyPondError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class LilyPondRenderer extends Context.Service<
  LilyPondRenderer,
  {
    readonly renderToSvg: (
      notes: readonly Note[],
    ) => Effect.Effect<Uint8Array, LilyPondError>;
  }
>()("app/LilyPondRenderer") {
  static readonly layer = Layer.effect(
    LilyPondRenderer,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const lyToSvg = Effect.fn("LilyPondRenderer.lyToSvg")(function* (
        lyContent: string,
      ) {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const tmpDir = yield* fs.makeTempDirectoryScoped({
              prefix: "lilypond-",
            });
            const tmpLy = path.join(tmpDir, "score.ly");
            const outputBase = path.join(tmpDir, "score");

            yield* fs.writeFileString(tmpLy, lyContent);

            yield* spawner.string(
              ChildProcess.make("lilypond", [
                "-dbackend=svg",
                "-o",
                outputBase,
                tmpLy,
              ]),
            );

            return yield* fs.readFile(`${outputBase}.svg`);
          }),
        );
      });

      const renderToSvg = Effect.fn("LilyPondRenderer.renderToSvg")(function* (
        notes: readonly Note[],
      ) {
        const quantized = yield* quantizeNotes(notes);
        const lyContent = notesToLilyPond(quantized);

        const svgBuffer = yield* lyToSvg(lyContent).pipe(
          Effect.mapError(
            (e) => new LilyPondError({ message: "lilypond failed", cause: e }),
          ),
        );

        return svgBuffer;
      });

      return LilyPondRenderer.of({ renderToSvg });
    }),
  ).pipe(Layer.provide(NodeServices.layer));
}
