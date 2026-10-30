import type { OxlintOverride } from "vite-plus/lint";

import { astryxStylex } from "@astryxdesign/build/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { dirname, relative } from "node:path";
import { defineConfig, lazyPlugins } from "vite-plus";

/**
 * Effect is consumed one module at a time: `import * as Effect from "effect/Effect"`. The root
 * barrel drags all 160 modules through Vite dev and the server bundle.
 */
const effectBarrel = {
  name: "effect",
  message:
    'Import Effect modules by path: import * as Effect from "effect/Effect".',
};

/** A subpackage's index (`effect/rpc`) is a barrel too; its modules have paths: `effect/rpc/RpcClient`. */
const effectSubpackageBarrel = {
  regex: "^effect/[a-z]+$",
  message:
    'Import Effect subpackage modules by path: import * as RpcClient from "effect/rpc/RpcClient".',
};

/**
 * A path that climbs out of its folder names its target by the `package.json` `imports` entry
 * instead: `#domain/live.ts`, not `../../domain/live.ts`. The entry says which area the
 * import enters, and it stays valid when the importing file moves.
 */
const parentPath = {
  regex: String.raw`(^|/)\.\.(/|$)`,
  message: "Import across folders through a `#` subpath: #domain/…, #web/….",
};

const aliasPath = {
  regex: "^@/",
  message: "Import across folders through a `#` subpath: #domain/…, #web/….",
};

/** `#root/*` is for the files that must sit at the repository root; an area's file has its own entry. */
const rootIntoArea = {
  regex: "^#root/(src|scripts)/",
  message:
    "Reach an area's file through its own entry: #domain/…, #web/…, #scripts/….",
};

/** Every override's `no-restricted-imports` options start from these; see {@link domainBoundary}. */
const baseRestrictions = {
  paths: [effectBarrel],
  patterns: [effectSubpackageBarrel, parentPath, aliasPath, rootIntoArea],
};

/**
 * Keeps `src/domain/` below the website: a domain file imports only `effect` and the domain files
 * it builds on. `file` is a path under `src/domain/`; `siblings` are the domain files it may not
 * import, which would close a cycle. When two overrides match a file, the later one's options
 * replace the earlier's, so each carries {@link baseRestrictions} and the area group again.
 */
const domainBoundary = (
  file: string,
  siblings: readonly string[] = [],
): OxlintOverride => ({
  files: [`src/domain/${file}`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        ...baseRestrictions,
        patterns: [
          ...baseRestrictions.patterns,
          {
            group: ["#web/**"],
            message: "The domain imports only `effect` and its own files.",
          },
          ...(siblings.length === 0
            ? []
            : [
                {
                  group: siblings.flatMap((sibling) => [
                    `#domain/${sibling}`,
                    `./${relative(dirname(file), sibling)}`,
                  ]),
                  message:
                    "A domain file imports only the domain files it builds on.",
                },
              ]),
        ],
      },
    ],
  },
});

const webOnlyRules = [
  ...[
    "capitalized-calls",
    "checked-requires-onchange-or-readonly",
    "display-name",
    "error-boundaries",
    "exhaustive-deps",
    "exhaustive-effect-dependencies",
    "forward-ref-uses-ref",
    "function-component-definition",
    "globals",
    "hook-use-state",
    "hooks",
    "iframe-missing-sandbox",
    "immutability",
    "incompatible-library",
    "jsx-boolean-value",
    "jsx-curly-brace-presence",
    "jsx-fragments",
    "jsx-key",
    "jsx-no-comment-textnodes",
    "jsx-no-constructed-context-values",
    "jsx-no-duplicate-props",
    "jsx-no-script-url",
    "jsx-no-target-blank",
    "jsx-no-undef",
    "jsx-no-useless-fragment",
    "jsx-pascal-case",
    "jsx-props-no-spread-multi",
    "memo-dependencies",
    "no-array-index-key",
    "no-children-prop",
    "no-danger-with-children",
    "no-deriving-state-in-effects",
    "no-did-mount-set-state",
    "no-did-update-set-state",
    "no-direct-mutation-state",
    "no-find-dom-node",
    "no-is-mounted",
    "no-namespace",
    "no-object-type-as-default-prop",
    "no-redundant-should-component-update",
    "no-render-return-value",
    "no-set-state",
    "no-string-refs",
    "no-this-in-sfc",
    "no-unsafe",
    "no-unstable-nested-components",
    "no-will-update-set-state",
    "prefer-es6-class",
    "preserve-manual-memoization",
    "purity",
    "refs",
    "rules-of-hooks",
    "self-closing-comp",
    "set-state-in-effect",
    "set-state-in-render",
    "state-in-constructor",
    "static-components",
    "style-prop-object",
    "use-memo",
    "void-dom-elements-no-children",
    "void-use-memo",
  ].map((rule) => `react/${rule}`),
  ...[
    "alt-text",
    "anchor-has-content",
    "anchor-is-valid",
    "aria-activedescendant-has-tabindex",
    "aria-props",
    "aria-proptypes",
    "aria-role",
    "aria-unsupported-elements",
    "autocomplete-valid",
    "click-events-have-key-events",
    "control-has-associated-label",
    "heading-has-content",
    "html-has-lang",
    "iframe-has-title",
    "img-redundant-alt",
    "interactive-supports-focus",
    "label-has-associated-control",
    "lang",
    "media-has-caption",
    "mouse-events-have-key-events",
    "no-access-key",
    "no-aria-hidden-on-focusable",
    "no-autofocus",
    "no-distracting-elements",
    "no-interactive-element-to-noninteractive-role",
    "no-noninteractive-element-interactions",
    "no-noninteractive-element-to-interactive-role",
    "no-noninteractive-tabindex",
    "no-redundant-roles",
    "no-static-element-interactions",
    "prefer-tag-over-role",
    "role-has-required-aria-props",
    "role-supports-aria-props",
    "scope",
    "tabindex-no-positive",
  ].map((rule) => `jsx-a11y/${rule}`),
  "@tanstack/router/create-route-property-order",
  "@tanstack/router/route-param-names",
];

export default defineConfig({
  fmt: {
    printWidth: 80,
    ignorePatterns: ["src/web/routeTree.gen.ts"],
    sortImports: {
      groups: [
        "type-builtin",
        "type-external",
        "type-internal",
        ["type-parent", "type-sibling", "type-index"],
        "react-libs",
        ["value-builtin", "value-external"],
        "value-internal",
        ["value-parent", "value-sibling", "value-index"],
        "unknown",
      ],
      customGroups: [
        {
          groupName: "react-libs",
          elementNamePattern: ["react", "react-**"],
        },
      ],
    },
  },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "jsx-a11y"],
    settings: {
      react: {
        linkComponents: [
          {
            name: "Link",
            attribute: "to",
          },
        ],
      },
    },
    categories: {
      correctness: "error",
      suspicious: "error",
      pedantic: "error",
      perf: "error",
      style: "error",
    },
    env: {
      builtin: true,
    },
    ignorePatterns: [
      "dist/",
      "docs/",
      "refs/",
      "tmp/",
      "src/web/routeTree.gen.ts",
    ],
    rules: {
      // Options on enabled rules, and opt-ins beyond the categories.
      "no-underscore-dangle": [
        "error",
        {
          allow: ["_tag"],
        },
      ],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          minimumDescriptionLength: 10,
        },
      ],
      "@typescript-eslint/restrict-plus-operands": [
        "error",
        {
          allowAny: false,
          allowBoolean: false,
          allowNullish: false,
          allowNumberAndString: false,
          allowRegExp: false,
        },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: false,
          allowRegExp: false,
        },
      ],
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allow: [
            {
              from: "package",
              package: "@tanstack/router-core",
              name: ["Redirect", "NotFoundError"],
            },
            { from: "lib", name: "Response" },
          ],
        },
      ],
      "react/no-unstable-nested-components": [
        "error",
        {
          allowAsProps: true,
        },
      ],
      "@typescript-eslint/return-await": [
        "error",
        "error-handling-correctness-only",
      ],
      "no-empty": "error",
      "no-empty-function": "error",
      "no-regex-spaces": "error",
      "no-unused-expressions": "error",
      "@typescript-eslint/no-dynamic-delete": "error",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-invalid-void-type": "error",
      "@typescript-eslint/no-namespace": "error",
      "@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/non-nullable-type-assertion-style": "error",
      "@typescript-eslint/prefer-literal-enum-member": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
      "@tanstack/router/create-route-property-order": "error",
      "@tanstack/router/route-param-names": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
      "conventions/effect-namespace-import": "error",
      "no-restricted-imports": ["error", baseRestrictions],

      // Off: misreads Effect (pipeable data-last calls, `Effect.gen` and `Effect.fn` bodies,
      // capitalized constructors such as `Schema.Struct`, `Effect.succeed(undefined)`).
      "unicorn/no-array-method-this-argument": "off",
      "unicorn/no-array-callback-reference": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/max-nested-calls": "off",
      "unicorn/no-useless-undefined": "off",
      "unicorn/catch-error-name": "off",
      "@typescript-eslint/consistent-return": "off",
      "@typescript-eslint/strict-void-return": "off",
      "new-cap": "off",
      "func-names": "off",
      "func-style": "off",
      "require-await": "off",

      // Off: contradicts house style.
      "no-ternary": "off",
      "no-nested-ternary": "off",
      "unicorn/no-nested-ternary": "off",
      "unicorn/no-null": "off",
      "unicorn/throw-new-error": "off",
      "unicorn/no-await-expression-member": "off",
      "unicorn/prefer-global-this": "off",
      "unicorn/text-encoding-identifier-case": "off",
      "unicorn/filename-case": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "typescript/prefer-readonly-parameter-types": "off",
      "sort-keys": "off",
      "no-magic-numbers": "off",
      "no-negated-condition": "off",
      "no-continue": "off",
      "no-shadow": "off",
      "no-inline-comments": "off",
      "no-implicit-coercion": "off",
      "capitalized-comments": "off",
      "arrow-body-style": "off",
      "prefer-destructuring": "off",
      "init-declarations": "off",
      "one-var": "off",
      "id-length": "off",
      "max-params": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-classes-per-file": "off",
      "max-statements": "off",
      "jsx-max-depth": "off",
      "jsx-props-no-spreading": "off",
      "no-unescaped-entities": "off",
      "no-await-in-loop": "off",
      "oxc/no-map-spread": "off",
      "jsx-handler-names": "off",

      // Off: the formatter or the JSX transform owns it.
      "sort-imports": "off",
      "no-duplicate-imports": "off",
      curly: "off",
      "unicorn/number-literal-case": "off",
      "react-in-jsx-scope": "off",
    },
    jsPlugins: [
      "@tanstack/eslint-plugin-router",
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
      "./scripts/lint/conventions.ts",
    ],
    overrides: [
      {
        files: ["**"],
        excludeFiles: ["src/web/**"],
        rules: Object.fromEntries(
          webOnlyRules.map((rule) => [rule, "off" as const]),
        ),
      },
      domainBoundary("**"),
      domainBoundary("live.ts", [
        "beatTime.ts",
        "noteEdits.ts",
        "clipBuffers.ts",
        "lilypond/quantizer.ts",
        "lilypond/score.ts",
        "score/staffDecision.ts",
      ]),
      domainBoundary("beatTime.ts", ["noteEdits.ts", "clipBuffers.ts"]),
      domainBoundary("noteEdits.ts", ["clipBuffers.ts"]),
      domainBoundary("score/staffDecision.ts", ["lilypond/score.ts"]),
      {
        files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
        rules: {
          "constructor-super": "off",
          "no-class-assign": "off",
          "no-const-assign": "off",
          "no-dupe-class-members": "off",
          "no-dupe-keys": "off",
          "no-func-assign": "off",
          "no-import-assign": "off",
          "no-new-native-nonconstructor": "off",
          "no-obj-calls": "off",
          "no-redeclare": "off",
          "no-setter-return": "off",
          "no-this-before-super": "off",
          "no-unsafe-negation": "off",
          "no-var": "error",
          "no-with": "off",
          "prefer-const": "error",
          "prefer-rest-params": "error",
          "prefer-spread": "error",
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  server: {
    port: 4500,
  },
  ssr: {
    noExternal: ["@astryxdesign/core", "@astryxdesign/theme-neutral"],
    optimizeDeps: {
      exclude: ["@astryxdesign/core", "@astryxdesign/theme-neutral"],
    },
  },
  build: {
    cssTarget: "chrome123",
  },
  plugins: lazyPlugins(() => [
    ...astryxStylex(),
    tanstackStart({
      srcDirectory: "src/web",
    }),
    viteReact(),
  ]),
});
