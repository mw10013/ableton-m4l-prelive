# AGENTS.md

- Prefer JSDoc for comments for complex and subtle behavior the code cannot show. A JSDoc must carry its reasoning inline and must cite neither `docs/` nor `refs/` — research docs go stale and get deleted, and refs are refetched at another version. The code is the truth, the JSDoc next; a stable external URL is the only acceptable citation.
- Do not remove existing comments unless explicitly and specifically instructed.
- Your answers and explanations should be concise and scannable so the user can scan quickly and easily understand. Scarifice grammar for the sake of concision.
- Ground your answers and explanations with excerpts from documentation and code.

## Project

- `prelive` is a TanStack Start application with effect v4, Astryx design system components, TypeScript, StyleX.
- Astryx (`@astryxdesign/core`) is the design system, with `@astryxdesign/theme-neutral` as the theme. **No Tailwind.** One-off styling that no component prop covers goes through StyleX (`xstyle` prop), never raw CSS. `src/web/styles.css` holds only the `@layer` order and the two Astryx CSS imports.
- Route modules are in `src/web/routes/` and use file route conventions. TanStack Start's `srcDirectory` is `src/web`.

## Refs

Version-matched library sources live in `refs/`, managed by the shared refs CLI. `package.json` pins are the version authority; after a dependency bump, re-run sync.

```bash
vpx /Users/mw/projects/tools/refs.ts status   # Compare refs/ against package.json pins
vpx /Users/mw/projects/tools/refs.ts sync     # Fetch every supported declared dependency
```

`refs` is ignored as `/refs` (no trailing slash) so a linked worktree's `refs` symlink to the main checkout is ignored too. Never edit inside `refs/`; sync replaces it.

### Reference Docs Locations

- **TanStack Start**: `refs/tanstack-start/docs/start/` (MDX files - framework/react)
- **TanStack Router**: `refs/tanstack-start/docs/router/` (same repository archive as Start)
- **Astryx**: `refs/astryx/` (component source in `packages/core/src/`, build plugin in `packages/build/`)
- **Effect Docs**: `refs/effect/ai-docs/src/`
- **liveql schema**: `refs/liveql-schema.graphql`, written by `vp run liveql:schema` from a running liveql server

## Commands

```bash
vp run dev              # Start the dev server on this checkout's port from berth (berth.json), or adopt the running one
vp run dev:open         # Same, then open it in the browser
vp run dev:status       # Where it runs and whether it answers (exit 1 when unhealthy)
vp run dev:stop         # Stop it wherever it runs
vp run dev:logs         # Tail .logs/dev/current
vp check                # Format check, lint, and type check (read-only)
vp check --fix          # Same, applying formatting and safe lint fixes
vp build                # Production build
vp test run             # Unit tests (test/unit) and component tests in Chromium (test/browser)
pnpm astryx <cmd>       # Astryx CLI (see the ASTRYX block at the end of this file)
```

- Run `vp check` and `vp test run` after generating code. Unit tests live in `test/unit/` (`@effect/vitest`); component and hook tests live in `test/browser/` and run in Chromium (`vitest-browser-react`). Tests reach code through `#domain/*` and `#web/*` and assert behavior a user or caller can observe.

## Server Log Monitoring

`.logs/dev/current` is the dev server's live log (`s6-log`, timestamped, rotated), with `==== dev start` and `==== dev exit` markers around each run. Read it with `vp run dev:logs` or `tail` to check for build errors and runtime issues. Always start the server with `vp run dev`: a bare `vp dev` is rejected by `vite.config.ts`. With herdr running, the server runs in the checkout's herdr workspace, tab `dev`; otherwise in the caller's terminal or the background.

## TypeScript Guidelines

- Always follow functional programming principles and effect v4 patterns and idioms.
- Use interfaces for data structures and type definitions
- Prefer immutable data (const, readonly)
- Use optional chaining (?.) and nullish coalescing (??) operators
- **Do not add comments to generated code** beyond the JSDoc rule above. Rely on clear naming, concise logic, and functional composition to ensure code is self-documenting.
- Employ a concise and dense coding style. Prefer inlining expressions, function composition (e.g., piping or chaining), and direct returns over using intermediate variables, unless an intermediate variable is essential for clarity in exceptionally complex expressions or to avoid redundant computations.
- Inline types when practical instead of introducing extra interfaces or type aliases.
- Avoid intermediate variables that are not necessary for clarity.
- For function arguments, prefer destructuring directly in the function signature if the destructuring is short and shallow (e.g., `({ data: { value }, otherArg })`). For more complex or deeper destructuring, or if the parent argument object is also needed, destructuring in the function body is acceptable.
- Effect modules are imported as namespaces by path (`import * as Effect from "effect/Effect"`), never from the `effect` barrel or a subpackage index; lint enforces it. Other large libraries also take namespace imports.
- **Strict mode enabled**: All strict TypeScript checks are on
- **No unused variables/parameters**: Prefix with `_` if intentionally unused
- **Type imports**: Use `import type` for type-only imports when possible
- **Imports and layout**: `src/domain/` holds pure concepts (schemas and functions over them) and imports only `effect` and itself. `src/web/` holds the TanStack Start app, its server code under `src/web/server/`. Leaving a file's folder goes through a `package.json` `imports` entry with the extension (`#domain/live.ts`, `#web/server/LiveQL.ts`); within the folder and below, `./`. No `..`, no `@/`.

```ts
import type { ReplacementNote } from "#domain/live.ts";

import * as React from "react";

import { createServerFn } from "@tanstack/react-start";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Schema from "effect/Schema";

import { LiveQL } from "#web/server/LiveQL.ts";

import { useScrub } from "./useScrub.ts";
```

## TanStack

- TanStack typing is world-class. You should not need to type cast and should let typescript infer types wherever possible.
- Start loaders are isomorphic so generally create a server fn with server logic and call it from loader.
- **beforeLoad vs loader**: Use `beforeLoad` for route guards (auth, authorization) - returns merge into context. Use `loader` for data fetching - route-specific, parallel execution.
- **Execution order**: `beforeLoad` runs sequentially parent→child. `loader` runs in parallel across all active routes after beforeLoad completes.

## Linting & Formatting

- Uses **Vite+** (`vp`), which bundles **oxlint** (not ESLint) and **oxfmt** (not Prettier). Both are configured in `vite.config.ts` under `lint` and `fmt`. The lint block is the house rule set shared with other apps: every enabled rule is an error, Effect modules are imported as namespaces by path (`import * as Effect from "effect/Effect"`), and `src/domain` may not import `src/web`. Suppress one site at a time with `// oxlint-disable-next-line <rule> -- <reason>`.
- Do not add ESLint or Prettier config.
- `src/web/routeTree.gen.ts` is excluded from linting/formatting.

## Astryx and StyleX

- **Discover through the CLI, never from memory.** `pnpm astryx build "<idea>"` → `pnpm astryx template <name>` → `pnpm astryx component <Name>`. The full command surface is in the `ASTRYX` block at the end of this file; `pnpm astryx doctor` diagnoses a broken setup.
- **No Tailwind, no hand-written CSS, no `style={{}}`.** Reach for a component prop first. When none exists, use `xstyle` with `stylex.create` and Astryx token vars from `@astryxdesign/core/theme/tokens.stylex` — never raw hex or px. `src/web/routes/index.tsx` carries the one worked example.

## Do Not Edit

The following are auto-generated or externally managed:

- `src/web/routeTree.gen.ts` - Generated by TanStack Router
- `refs/` directory - External reference code (excluded from TypeScript/linting)

<!-- ASTRYX:START -->

Astryx v0.7.4 · 173 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
import "@astryxdesign/core/reset.css";
import "@astryxdesign/theme-neutral/theme.css";

<!-- `astryx init` and `astryx upgrade --apply` regenerate the lines above as `@astryxdesign/core/astryx.css`; re-apply this correction by hand. `astryx.css` is the prebuilt-CSS path, while this project does a source build through `astryxStylex` in `vite.config.ts`, so the theme package ships the tokens instead. Both imports live in `src/web/styles.css`, under the `@layer reset, astryx-base, astryx-theme, product` order that file declares — not in an entry module. -->

WORKFLOW — start every page from a template, never from scratch:

1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
   Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
   Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:

- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then the xstyle prop / StyleX tokens. No raw hex/px.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any className=, style={{…}}, raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or the xstyle prop + a token.

`astryx help` lists every command. Key ones beyond the workflow:
search "<query>" find any component / hook / doc / template
discover <words> integrations you could add
docs <topic> getting-started, principles, tokens, theme … (`astryx docs` lists all)
docs cli commands and API reference
docs authoring build an integration package, and every field it holds
upgrade --from <old version> --apply run after a dependency bump
<!-- ASTRYX:END -->
