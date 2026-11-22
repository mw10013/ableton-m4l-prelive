Use coder skill.

## Project

- `prelive` is a TanStack Start application with effect v4, Astryx design system components, TypeScript, StyleX.
- Astryx (`@astryxdesign/core`) is the design system, with `@astryxdesign/theme-neutral` as the theme. **No Tailwind.** One-off styling that no component prop covers goes through StyleX (`xstyle` prop), never raw CSS. `src/web/styles.css` holds only the `@layer` order and the two Astryx CSS imports.
- Route modules are in `src/web/routes/` and use file route conventions. TanStack Start's `srcDirectory` is `src/web`.

### Reference Docs Locations

- **TanStack Start**: `refs/tanstack-start/docs/start/` (MDX files - framework/react)
- **TanStack Router**: `refs/tanstack-start/docs/router/` (same repository archive as Start)
- **Astryx**: `refs/astryx/` (component source in `packages/core/src/`, build plugin in `packages/build/`)
- **Effect Docs**: `refs/effect/ai-docs/src/`
- **liveql schema**: `refs/liveql-schema.graphql`, written by `vp run liveql:schema` from a running liveql server

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
