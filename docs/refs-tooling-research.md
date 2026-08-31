# Reference Source Tooling Migration

Date: 2026-08-31

Goal: determine whether Prelive can replace its individual `refs:*` shell scripts
with Baton's centralized `scripts/refs.ts`, rename `refs/effect4` to
`refs/effect`, and add the private `mw10013/ableton-extension-prelive` repository
as `refs/extension-prelive`.

## Conclusion

The migration is feasible. Prelive already has the required runtime packages,
uses exact versions for every package-backed ref, and runs Node 26.7.0, which can
execute the TypeScript script directly.

Port Baton's tarball-only core rather than copying its file unchanged. Baton's
script imports `./refs-shopify-docs.ts` and carries Shopify-specific fields that
Prelive does not need:

```ts
import * as ShopifyDocs from "./refs-shopify-docs.ts";
```

`../baton/scripts/refs.ts:18`

The resulting Prelive script can remain materially smaller while retaining the
important behavior: package-derived versions, literal pins, branch refs, private
GitHub authentication, status stamps, atomic replacement, and CLI validation.

## Current State

Prelive currently defines one destructive shell pipeline per ref. Effect is
representative:

```json
"refs:effect4": "rm -rf refs/effect4 && mkdir -p refs/effect4 && curl -L https://github.com/Effect-TS/effect/archive/refs/tags/effect@4.0.0-rc.112.tar.gz | tar -xz -C refs/effect4 --strip-components=1"
```

`package.json:19`

This has four weaknesses:

- Versions are duplicated between dependency declarations and shell commands.
- A failed download can delete or partially replace a usable existing ref.
- There is no machine-readable record of what was fetched or when.
- There is no aggregate fetch or drift check.

There are currently 12 downloaded directories under `refs/`, totaling roughly
469 MB. They have no `.ref.json` stamps, so the new tool will initially report
every entry as missing until it is fetched through the new script.

The existing commands have already drifted from application dependencies. For
example, `package.json:16` fetches a dated Router release while
`package.json:35` depends on `@tanstack/react-router` `1.170.32`. The Start
command has the same problem. Central version resolution removes this class of
drift.

## Baton Structure

Baton exposes one general command plus two shortcuts:

```json
"refs": "node scripts/refs.ts",
"refs:all": "node scripts/refs.ts fetch --all",
"refs:check": "node scripts/refs.ts check"
```

`../baton/package.json:53-55`

The CLI supports:

```text
node scripts/refs.ts fetch <name...>
node scripts/refs.ts fetch --all
node scripts/refs.ts check
node scripts/refs.ts list
```

`../baton/scripts/refs.ts:5-8`

Each ref declares its source once. Package-backed entries read their exact
version from `package.json`:

```ts
{
  name: "effect",
  repo: "Effect-TS/effect",
  tag: "effect@{v}",
  version: { from: ".", dep: "effect" },
}
```

`../baton/scripts/refs.ts:60-65`

Private repositories switch the downloader from anonymous `curl` to
authenticated GitHub CLI access:

```ts
const tarball = ref.private
  ? ChildProcess.make("gh", ["api", `repos/${ref.repo ?? ""}/tarball/${target}`], {
      stderr: "inherit",
    })
```

`../baton/scripts/refs.ts:283-288`

Downloads are extracted into a temporary directory first. The destination is
removed and replaced only after download and extraction succeed:

```ts
const staging = yield * fs.makeTempDirectory({ prefix: `refs-${ref.name}-` });
```

```ts
yield * fs.remove(refDir, { recursive: true, force: true });
yield * fs.rename(staging, refDir);
```

`../baton/scripts/refs.ts:351-370`

Each successful fetch writes `.ref.json` with source, resolved target, version,
and timestamp. `check` compares that stamp with current package pins and exits
nonzero for missing, invalid, or version-drifted refs.

## Recommended Ref Inventory

| Name                | Source                                           | Resolution                                                            | Destination              |
| ------------------- | ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------ |
| `effect`            | `Effect-TS/effect`                               | `effect` dependency, tag `effect@{v}`                                 | `refs/effect`            |
| `tan-start`         | `TanStack/router`                                | `@tanstack/react-start` dependency, tag `@tanstack/react-start@{v}`   | `refs/tan-start`         |
| `tan-router`        | `TanStack/router`                                | `@tanstack/react-router` dependency, tag `@tanstack/react-router@{v}` | `refs/tan-router`        |
| `tan-query`         | `TanStack/query`                                 | `@tanstack/react-query` dependency, tag `@tanstack/react-query@{v}`   | `refs/tan-query`         |
| `tan-form`          | `TanStack/form`                                  | literal `1.28.5`, tag `@tanstack/react-form@{v}`                      | `refs/tan-form`          |
| `tan-table`         | `TanStack/table`                                 | literal `9.2.4`, tag `@tanstack/react-table@{v}`                      | `refs/tan-table`         |
| `liveql`            | `mw10013/ableton-m4l-liveql`                     | branch `main`                                                         | `refs/liveql`            |
| `bang`              | `mw10013/bang`                                   | private branch `main`                                                 | `refs/bang`              |
| `tceas`             | `mw10013/tanstack-cloudflare-effect-astryx-saas` | branch `main`                                                         | `refs/tceas`             |
| `lilypond`          | `lilypond/lilypond`                              | branch `master`                                                       | `refs/lilypond`          |
| `astryx`            | `facebook/astryx`                                | `@astryxdesign/core` dependency, tag `v{v}`                           | `refs/astryx`            |
| `stylex`            | `facebook/stylex`                                | `@stylexjs/stylex` dependency, tag `{v}`                              | `refs/stylex`            |
| `extension-prelive` | `mw10013/ableton-extension-prelive`              | private branch `main`                                                 | `refs/extension-prelive` |

The package-derived tags and the two literal TanStack tags were verified through
the GitHub API. `mw10013/ableton-extension-prelive` was also verified as a
private repository with default branch `main`; an authenticated
`gh api repos/mw10013/ableton-extension-prelive/tarball/main` request returned
HTTP 200.

The LiveQL source should use its current canonical repository name,
`mw10013/ableton-m4l-liveql`. GitHub currently resolves the old
`mw10013/ableton-live-liveql` name, but retaining the renamed alias is needless
indirection.

## Pins Versus Branches

`tan-form` and `tan-table` are refs but are not dependencies anywhere in `src/` or
`package.json`. Baton's `pin` field is the right representation: the version is
explicit in `scripts/refs.ts`, and changing it makes the existing stamp stale.
Adding unused application dependencies solely to own these versions would be
misleading.

Branch refs cannot provide true drift detection. Their stamp records `main` or
`master`, not a commit SHA. Baton's check therefore reports only age:

```ts
const days = Math.floor(
  (Date.now() - Date.parse(stamp.fetchedAt)) / 86_400_000,
);
```

`../baton/scripts/refs.ts:394-400`

This means `refs:check` remains green when a tracked branch advances. That is
acceptable if branch refs are intentionally refreshed on demand, but the output
must be read as freshness information, not reproducibility. Commit pins would be
a separate enhancement and are not required for parity with Baton.

## Effect Rename

Rename the logical ref from `effect4` to `effect`, matching Baton and the source
project. Effect v4 remains clear from the pinned version and project guidance;
the numeral in the directory adds no useful distinction.

Required migration edits:

- Replace the package script name `refs:effect4` with the centralized commands.
- Fetch into `refs/effect` and remove the ignored, obsolete `refs/effect4` copy.
- Change `AGENTS.md:29` from `refs/effect4/ai-docs/src/` to
  `refs/effect/ai-docs/src/`.

No source or research document currently references `refs/effect4`; the package
script and `AGENTS.md` are the complete tracked-file impact.

## Runtime And Validation

Prelive already declares exact matching versions of the script's runtime:

```json
"@effect/platform-node": "4.0.0-rc.112",
"effect": "4.0.0-rc.112"
```

`package.json:32,40`

Both are installed. Baton's script also executed successfully in the local Node
26.7.0 environment and reported all of Baton's refs.

One validation gap should be closed during implementation. Prelive's TypeScript
configuration currently includes only `src` and `vite.config.ts`:

```json
"include": ["src", "vite.config.ts"]
```

`tsconfig.json:21`

Either add `scripts` to that include or add a dedicated scripts tsconfig. The
minimal choice is `"include": ["src", "scripts", "vite.config.ts"]`, allowing
the existing `pnpm typecheck` to validate the new tool. Lint already scans
`scripts/`.

## Proposed Implementation

1. Add `scripts/refs.ts`, starting from Baton's script but removing npm,
   Shopify-doc, and opt-in machinery not used by the recommended inventory.
2. Define the 13 refs in the table above; use `private: true` for `bang` and
   `extension-prelive`.
3. Replace all individual `refs:*` package scripts with `refs`, `refs:all`, and
   `refs:check` exactly as Baton exposes them.
4. Include `scripts/` in TypeScript checking.
5. Update `AGENTS.md` for `refs/effect`, the new commands, and
   `refs/extension-prelive`.
6. Remove the obsolete ignored `refs/effect4` directory.
7. Run `pnpm refs fetch --all`, then `pnpm refs:check`, `pnpm typecheck`, and
   `pnpm lint`.

## Risks

- Private fetches require `gh` to be installed, authenticated, and authorized for
  both private repositories. Public refs need `curl`; all refs need `tar`.
- `fetch --all` will redownload roughly 469 MB plus `extension-prelive`; it should
  be an explicit developer command, not a routine install hook.
- The first centralized fetch replaces every destination and adds its ignored
  `.ref.json` stamp. Existing unstamped directories cannot be adopted safely
  because their source versions are not independently proven.
- Branch refs are mutable and age-only, as described above.
- Baton's temporary-directory replacement is much safer than the current shell
  commands, but replacement still requires enough free space for the old and new
  copies during extraction.

## Recommendation

Proceed with the migration as one focused change. Preserve Baton's command
surface and safety behavior, use package-derived versions wherever a dependency
exists, retain explicit pins for Form and Table, and add the private repository
as `refs/extension-prelive` through `gh api`.
