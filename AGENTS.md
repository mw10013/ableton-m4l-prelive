# AGENTS.md

- Prefer JSDoc for comments for complex and subtle behavior the code cannot show. A JSDoc must carry its reasoning inline and must cite neither `docs/` nor `refs/` — research docs go stale and get deleted, and refs are refetched at another version. The code is the truth, the JSDoc next; a stable external URL is the only acceptable citation.
- Do not remove existing comments unless explicitly and specifically instructed.
- Your answers and explanations should be concise and scannable so the user can scan quickly and easily understand. Scarifice grammar for the sake of concision.
- Ground your answers and explanations with excerpts from documentation and code.

## Project

- `prelive` is a TanStack Start application with effect v4, Astryx design system components, TypeScript, StyleX.
- Astryx (`@astryxdesign/core`) is the design system, with `@astryxdesign/theme-neutral` as the theme. **No Tailwind.** One-off styling that no component prop covers goes through StyleX (`xstyle` prop), never raw CSS. `src/styles.css` holds only the `@layer` order and the two Astryx CSS imports.
- Route modules are in `src/routes/` and use file route conventions.

## Refs

Downloaded source code of libraries are in `refs/` for reference.

### Reference Docs Locations

- **TanStack Start**: `refs/tan-start/docs/` (MDX files - start/framework/react)
- **TanStack Router**: `refs/tan-router/docs/` (MDX files - router/framework/react)
- **TanStack Query**: `refs/tan-query/docs/` (Markdown files - framework/react, reference, eslint)
- **TanStack Form**: `refs/tan-form/docs/` (Markdown files)
- **TanStack Table**: `refs/tan-table/` (docs/, packages/)
- **Astryx**: `refs/astryx/` (`facebook/astryx` v0.3.0 — component source in `packages/core/src/`, build plugin in `packages/build/`)
- **StyleX**: `refs/stylex/` (`facebook/stylex` v0.19.0 — docs in `apps/docs/`)
- **liveql**: `refs/liveql/` — GraphQL API for Ableton Live via Max for Live
  - GraphQL schema defined as `typeDefs` template literal in `refs/liveql/liveql-n4m.js` (types: `Song`, `SongView`, `Track`, `ClipSlot`, `Clip`, `Note`, `NotesDictionary` + input types, single `Query.live_set`, mutations for playback/clips/notes)
- **Effect Docs**: `refs/effect/ai-docs/src/` (Effect v4 release candidate)
- **LilyPond**: `refs/lilypond/` — Music engraving program (master branch)

## Commands

```bash
pnpm dev                # Start dev server (port 4500, logs to logs/server.log)
pnpm typecheck          # TypeScript type checking (tsc -b)
pnpm lint               # Run oxlint
pnpm fmt                # Format with oxfmt
pnpm fmt:check          # Check formatting without modifying
pnpm refs:check         # Report refs/ that drifted from package.json pins
pnpm refs fetch <name>  # Refetch a ref (see scripts/refs.ts; refs:all fetches all)
pnpm astryx <cmd>       # Astryx CLI (see the ASTRYX block at the end of this file)
```

- Run typecheck and lint after generating code.

## Server Log Monitoring

`logs/server.log` is a live, continuously growing log of dev server output. Use `tail` to check for build errors and runtime issues.

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
- Prefer namespace imports for large libraries.
- **Strict mode enabled**: All strict TypeScript checks are on
- **No unused variables/parameters**: Prefix with `_` if intentionally unused
- **Type imports**: Use `import type` for type-only imports when possible
- **Path aliases**: Use `@/*` for `src/*` imports (configured in tsconfig.json)

```ts
import type { Stripe as StripeTypes } from "stripe";
import * as React from "react";
import * as TanStackRouter from "@tanstack/react-router";
import * as TanStackStart from "@tanstack/react-start";
import * as z from "zod";
```

## TanStack

- TanStack typing is world-class. You should not need to type cast and should let typescript infer types wherever possible.
- Start loaders are isomorphic so generally create a server fn with server logic and call it from loader.
- **beforeLoad vs loader**: Use `beforeLoad` for route guards (auth, authorization) - returns merge into context. Use `loader` for data fetching - route-specific, parallel execution.
- **Execution order**: `beforeLoad` runs sequentially parent→child. `loader` runs in parallel across all active routes after beforeLoad completes.

## Linting & Formatting

- Uses **oxlint** (not ESLint) and **oxfmt** (not Prettier). Both are Rust-based and configured in `.oxlintrc.json` and `.oxfmtrc.json`.
- Do not add ESLint or Prettier config.
- `src/routeTree.gen.ts` is excluded from linting/formatting.

## Astryx and StyleX

- **Discover through the CLI, never from memory.** `pnpm astryx build "<idea>"` → `pnpm astryx template <name>` → `pnpm astryx component <Name>`. The full command surface is in the `ASTRYX` block at the end of this file; `pnpm astryx doctor` diagnoses a broken setup.
- **No Tailwind, no hand-written CSS, no `style={{}}`.** Reach for a component prop first. When none exists, use `xstyle` with `stylex.create` and Astryx token vars from `@astryxdesign/core/theme/tokens.stylex` — never raw hex or px. `src/routes/index.tsx` carries the one worked example.

## Do Not Edit

The following are auto-generated or externally managed:

- `src/routeTree.gen.ts` - Generated by TanStack Router
- `refs/` directory - External reference code (excluded from TypeScript/linting)

<!-- ASTRYX:START -->

Astryx v0.3.0 · 155 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
import "@astryxdesign/core/reset.css";
import "@astryxdesign/theme-neutral/theme.css";

<!-- `astryx init` regenerates the lines above as `@astryxdesign/core/astryx.css`; re-apply this correction by hand. `astryx.css` is the prebuilt-CSS path, while this project does a source build through `astryxStylex` in `vite.config.ts`, so the theme package ships the tokens instead. Both imports live in `src/styles.css`, under the `@layer reset, astryx-base, astryx-theme, product` order that file declares — not in an entry module. -->

WORKFLOW — discover, don't guess. Before writing UI:

1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:

- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Frame first: pick the shell (AppShell / Layout+LayoutPanel) and budget regions in px BEFORE writing content (`astryx docs layout`).
- Dense data = rows (Table, List/Item) edge-to-edge — never Card-wrapped list items. Card = dashboard widgets, galleries, settings groups only.
- Status → StatusDot/Token; Badge only for counts and enumerated states, never decoration.
- Custom styling: component props first; else the xstyle prop / StyleX tokens (@astryxdesign/core/theme/tokens.stylex). No raw hex/px.
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-\* in :root.
- SELF-CHECK before you finish: re-read the file and replace any className=, style={{…}}, raw <div>/<span> layout, imported .css/@apply, or hardcoded #hex/px with the component or the xstyle prop + a token. If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
search "<query>" find any component / hook / doc / template / block
component --list 155 components by category
template --list page + block recipes
docs <topic> color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
swizzle <Name> eject component source for deep customization
upgrade --apply run after any @astryxdesign/core bump

<!-- ASTRYX:END -->
