import { EventEmitter } from "node:events";
import { dirname, relative } from "node:path";

import { astryxStylex } from "@astryxdesign/build/vite";
import { bosunEndpoint } from "@mw10013/devkit/core/bosun-endpoint";
import { baseRestrictions, lint } from "@mw10013/devkit/core/lint/rules";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";
import type { OxlintOverride } from "vite-plus/lint";
import { playwright } from "vite-plus/test/browser-playwright";

/**
 * StyleX's dev plugin polls for CSS changes on an interval it clears only when its HTTP server emits
 * `close`. Vitest never starts that server listening, so `close` never fires and the interval kept
 * every test run alive until Vitest's 10 s close timeout. The plugin gets a stand-in that emits
 * `close` when the Vite server closes.
 */
const closingWithServer = (plugin: Plugin): Plugin => {
  const configure = plugin.configureServer;
  if (typeof configure !== "function") return plugin;
  return {
    ...plugin,
    configureServer(server) {
      // oxlint-disable-next-line unicorn/prefer-event-target -- StyleX listens with Node's `once`
      const httpServer = new EventEmitter();
      const close = server.close.bind(server);
      server.close = () => {
        httpServer.emit("close");
        return close();
      };
      const result: ReturnType<typeof configure> = configure.call(
        this,
        new Proxy(server, {
          get: (target, key): unknown =>
            key === "httpServer" ? httpServer : Reflect.get(target, key),
        }),
      );
      return result;
    },
  };
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

export default defineConfig(({ command, mode, isPreview }) => {
  if (
    command === "serve" &&
    isPreview === false &&
    process.env.VITEST !== "true" &&
    process.env.VP_RUN !== "1"
  ) {
    throw new Error("Use `vp run dev` to start the project dev server.");
  }
  return {
    fmt: {
      printWidth: 80,
      ignorePatterns: ["src/web/routeTree.gen.ts"],
      sortImports: true,
    },
    lint: {
      ...lint,
      plugins: [...lint.plugins, "react", "jsx-a11y"],
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
      ignorePatterns: [
        "dist/",
        "docs/",
        "refs/",
        "tmp/",
        "src/web/routeTree.gen.ts",
      ],
      rules: {
        ...lint.rules,
        "react/no-unstable-nested-components": [
          "error",
          {
            allowAsProps: true,
          },
        ],
        "@tanstack/router/create-route-property-order": "error",
        "@tanstack/router/route-param-names": "error",
      },
      jsPlugins: ["@tanstack/eslint-plugin-router", ...lint.jsPlugins],
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
        ...lint.overrides,
      ],
    },
    test: {
      projects: [
        { test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
        {
          // Components in Chromium. The unit and browser globs must not overlap: `vitest/browser`
          // throws in Node. StyleX only works compiled, so this project runs the Astryx build.
          plugins: [...astryxStylex().map(closingWithServer), viteReact()],
          // Discovered mid-run, a dependency reloads the test page and fails the file.
          optimizeDeps: {
            include: ["react/jsx-dev-runtime", "@tanstack/react-query"],
          },
          test: {
            name: "browser",
            include: ["test/browser/**/*.test.tsx"],
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
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
    // Tests exercise the domain only; the app's plugins keep Vite servers alive after a run.
    plugins: lazyPlugins(() =>
      mode === "test"
        ? []
        : [
            /**
             * The SSR build emits no stylesheet, so Astryx's layer split, which fails a build whose
             * StyleX rules it cannot find in a stylesheet, runs on the client build only.
             */
            ...astryxStylex().map((plugin): Plugin =>
              plugin.name === "astryx-build-layer-split"
                ? {
                    ...plugin,
                    applyToEnvironment: ({ name }) => name === "client",
                  }
                : plugin,
            ),
            bosunEndpoint(),
            tanstackStart({
              srcDirectory: "src/web",
            }),
            viteReact(),
          ],
    ),
  };
});
