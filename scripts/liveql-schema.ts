import type { IntrospectionQuery } from "graphql";

import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { writeFileSync } from "node:fs";

const endpoint = process.env.LIVEQL_ENDPOINT ?? "http://localhost:4000/graphql";
const outPath = "refs/liveql-schema.graphql";

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: getIntrospectionQuery() }),
});
if (!response.ok) {
  throw new Error(`Introspection request failed: ${String(response.status)}`);
}
const json = (await response.json()) as {
  data?: IntrospectionQuery;
  errors?: { message: string }[];
};
if (json.errors?.length) {
  throw new Error(json.errors.map((e) => e.message).join("; "));
}
if (json.data === undefined) {
  throw new Error("Introspection response missing data");
}
const sdl = printSchema(buildClientSchema(json.data));
writeFileSync(outPath, `${sdl}\n`);
console.log(`Wrote ${outPath} (${String(sdl.length)} bytes) from ${endpoint}`);
