import { defineConfig } from "@effect/graphql-generator/Config";

export default defineConfig({
  schema: "./src/web/server/liveql/liveql.graphql",
  documents: ["src/web/server/liveql/*.graphql"],
});
