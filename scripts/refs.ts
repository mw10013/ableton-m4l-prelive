import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createHash } from "node:crypto";

interface VersionSource {
  readonly from: string;
  readonly dep: string;
}

interface Crawl {
  readonly url: string;
  readonly include: string;
  readonly version: string;
  readonly browser?: boolean;
  readonly ignore?: readonly string[];
  readonly excludeSelector?: readonly string[];
  readonly externalFileDomain?: readonly string[];
}

interface FluidTopics {
  readonly tenant: string;
  readonly version: string;
  readonly locale: string;
  readonly maps: readonly {
    readonly title: string;
    readonly into: string;
  }[];
}

interface Ref {
  readonly name: string;
  readonly repo?: string;
  readonly tag?: string;
  readonly version?: VersionSource;
  readonly pin?: string;
  readonly branch?: string;
  readonly private?: boolean;
  readonly crawl?: Crawl;
  readonly fluidTopics?: FluidTopics;
  readonly optIn?: boolean;
}

const REFS: readonly Ref[] = [
  {
    name: "effect",
    repo: "Effect-TS/effect",
    tag: "effect@{v}",
    version: { from: ".", dep: "effect" },
  },
  {
    name: "tan-start",
    repo: "TanStack/router",
    tag: "@tanstack/react-start@{v}",
    version: { from: ".", dep: "@tanstack/react-start" },
  },
  {
    name: "tan-router",
    repo: "TanStack/router",
    tag: "@tanstack/react-router@{v}",
    version: { from: ".", dep: "@tanstack/react-router" },
  },
  {
    name: "tan-query",
    repo: "TanStack/query",
    tag: "@tanstack/react-query@{v}",
    version: { from: ".", dep: "@tanstack/react-query" },
  },
  {
    name: "tan-form",
    repo: "TanStack/form",
    tag: "@tanstack/react-form@{v}",
    pin: "1.28.5",
  },
  {
    name: "tan-table",
    repo: "TanStack/table",
    tag: "@tanstack/react-table@{v}",
    pin: "9.2.4",
  },
  {
    name: "liveql",
    repo: "mw10013/ableton-m4l-liveql",
    branch: "main",
  },
  {
    name: "bang",
    repo: "mw10013/bang",
    branch: "main",
    private: true,
  },
  {
    name: "tceas",
    repo: "mw10013/tanstack-cloudflare-effect-astryx-saas",
    branch: "main",
  },
  {
    name: "lilypond",
    repo: "lilypond/lilypond",
    branch: "master",
  },
  {
    name: "astryx",
    repo: "facebook/astryx",
    tag: "v{v}",
    version: { from: ".", dep: "@astryxdesign/core" },
  },
  {
    name: "stylex",
    repo: "facebook/stylex",
    tag: "{v}",
    version: { from: ".", dep: "@stylexjs/stylex" },
  },
  {
    name: "extension-prelive",
    repo: "mw10013/ableton-extension-prelive",
    branch: "main",
    private: true,
  },
  {
    name: "live-manual",
    crawl: {
      url: "https://www.ableton.com/en/live-manual/12/",
      include: "^https://www\\.ableton\\.com/en/live-manual/12/",
      version: "12",
      browser: true,
      excludeSelector: [".main-nav", ".main-footer"],
      externalFileDomain: ["ableton-production.imgix.net"],
    },
    optIn: true,
  },
  {
    name: "logic-manual",
    crawl: {
      url: "https://support.apple.com/guide/logicpro/welcome/12.3/mac/15.6",
      include:
        "^https://support\\.apple\\.com/guide/logicpro/(?:welcome|toc|(?:aside/)?[^/]*(?:lgcp[0-9a-f]+|(?:script(?:er|-editor)|javascript|handlemidi|processmidi|[gs]etparameter|parameterchanged|reset-function|midi-processing-functions|trace-object|midi-event)[^/]*))/12\\.3/mac/[^/]+$",
      version: "12.3",
      excludeSelector: [
        "#toc-hidden-content",
        "#globalheader",
        "#globalfooter",
        "#localnav-pattern",
        "#globalmessage-segment",
        ".ac-gf-breadcrumbs",
      ],
      ignore: [String.raw`^https://support\.apple\.com/guide/logicpro/.*/img/`],
      externalFileDomain: ["help.apple.com"],
    },
    optIn: true,
  },
  {
    name: "performer-manual",
    crawl: {
      url: "https://www.freqsound.com/SIRA/Digital%20Performer%20Help/dp_help_home.html",
      include:
        "^https://www\\.freqsound\\.com/SIRA/Digital%20Performer%20Help/",
      version: "unversioned",
      excludeSelector: ["#header", "#footer"],
    },
    optIn: true,
  },
  {
    name: "cubase-manual",
    fluidTopics: {
      tenant: "https://www.steinberg.help",
      version: "15.0",
      locale: "en",
      maps: [
        { title: "Cubase Pro Help", into: "operation-manual" },
        { title: "Cubase Pro Score Editor Help", into: "score-editor" },
      ],
    },
    optIn: true,
  },
];

const refNames = REFS.map(({ name }) => name);
const nameColumn = Math.max(...refNames.map((name) => name.length)) + 1;

class RefsError extends Schema.TaggedError<RefsError>()("RefsError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason;
  }
}

const Stamp = Schema.Struct({
  repo: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  resolved: Schema.String,
  version: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  fetchedAt: Schema.String,
});
const StampJson = Schema.fromJsonString(Stamp, { space: 2 });

const FtMaps = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      metadata: Schema.Array(
        Schema.Struct({
          key: Schema.String,
          values: Schema.Array(Schema.String),
        }),
      ),
    }),
  ),
);

interface TocNode {
  readonly tocId: string;
  readonly contentId: string;
  readonly title: string;
  readonly prettyUrl: string;
  readonly children: readonly TocNode[];
}

const TocNode = Schema.Struct({
  tocId: Schema.String,
  contentId: Schema.String,
  title: Schema.String,
  prettyUrl: Schema.String,
  children: Schema.Array(Schema.suspend((): Schema.Codec<TocNode> => TocNode)),
});

const FtToc = Schema.fromJsonString(Schema.Array(TocNode));

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    devDependencies: Schema.optional(
      Schema.Record(Schema.String, Schema.String),
    ),
  }),
);

const repoRoot = Effect.gen(function* () {
  const path = yield* Path.Path;
  const here = yield* path.fromFileUrl(new URL(import.meta.url));
  return path.join(path.dirname(here), "..");
});

const readManifest = Effect.fn(function* (manifestPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs
    .readFileString(manifestPath)
    .pipe(
      Effect.mapError(
        () => new RefsError({ reason: `no package.json at ${manifestPath}` }),
      ),
    );
  return yield* Schema.decodeEffect(Manifest)(text);
});

const assertExact = (version: string, source: VersionSource) =>
  /^\d/u.test(version)
    ? Effect.succeed(version)
    : new RefsError({
        reason: `${source.dep} in ${source.from} is a range (${version}); pin it exactly`,
      });

const resolveVersion = Effect.fn(function* (source: VersionSource) {
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const manifest = yield* readManifest(
    path.join(root, source.from, "package.json"),
  );
  const version =
    manifest.dependencies?.[source.dep] ??
    manifest.devDependencies?.[source.dep];
  if (version === undefined)
    return yield* new RefsError({
      reason: `${source.dep} is not a dependency of ${source.from}`,
    });
  return yield* assertExact(version, source);
});

interface ResolvedRef {
  readonly ref: Ref;
  readonly target: string;
  readonly version?: string;
  readonly source?: string;
}

const resolveRef = Effect.fn(function* (ref: Ref) {
  if (ref.branch) return { ref, target: ref.branch };
  if (ref.crawl) return { ref, target: ref.crawl.version };
  if (ref.fluidTopics) return { ref, target: ref.fluidTopics.version };
  if (ref.pin && ref.tag)
    return { ref, target: ref.tag.replace("{v}", ref.pin) };
  if (!ref.version || !ref.tag)
    return yield* new RefsError({
      reason: `${ref.name} needs a branch, a pin plus tag, or a version plus tag`,
    });
  const version = yield* resolveVersion(ref.version).pipe(
    Effect.mapError((error) =>
      error instanceof RefsError
        ? error
        : new RefsError({ reason: error.message }),
    ),
  );
  return {
    ref,
    target: ref.tag.replace("{v}", version),
    version,
    source: `${ref.version.from} ${ref.version.dep}`,
  };
});

const readStamp = Effect.fn(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const stampPath = path.join(root, "refs", name, ".ref.json");
  return (yield* fs.exists(stampPath))
    ? yield* Schema.decodeEffect(StampJson)(yield* fs.readFileString(stampPath))
    : undefined;
});

const downloadInto = Effect.fn(function* (
  staging: string,
  ref: Ref,
  repo: string,
  target: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const downloadCommand = ref.private
    ? ChildProcess.make("gh", ["api", `repos/${repo}/tarball/${target}`], {
        stderr: "inherit",
      })
    : ChildProcess.make(
        "curl",
        [
          "-fsSL",
          `https://github.com/${repo}/archive/refs/${ref.branch ? "heads" : "tags"}/${target}.tar.gz`,
        ],
        { stderr: "inherit" },
      );
  yield* Effect.scoped(
    Effect.gen(function* () {
      const download = yield* spawner.spawn(downloadCommand);
      const extract = ChildProcess.make(
        "tar",
        ["-xz", "-C", staging, "--strip-components=1"],
        {
          stderr: "inherit",
          stdin: download.stdout,
        },
      );
      const tarExit = yield* spawner.exitCode(extract);
      const downloadExit = yield* download.exitCode;
      if (downloadExit !== 0 || tarExit !== 0)
        return yield* new RefsError({
          reason: `download of ${target} failed (exit ${String(downloadExit || tarExit)})`,
        });
    }),
  );
});

const CRAWLER = "siteone-crawler";

const httpGet = Effect.fn(function* (url: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`${String(response.status)} ${response.statusText}`);
      return await response.text();
    },
    catch: (error) =>
      new RefsError({
        reason: `GET ${url} failed -- ${error instanceof Error ? error.message : String(error)}`,
      }),
  });
});

const assertCrawler = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  if (
    (yield* spawner.exitCode(
      ChildProcess.make("which", [CRAWLER], {
        stdout: "ignore",
        stderr: "ignore",
      }),
    )) !== 0
  )
    return yield* new RefsError({
      reason: `${CRAWLER} is not on PATH -- install it with \`brew install janreges/tap/${CRAWLER}\``,
    });
});

const flattenExternalAssets = Effect.fn(function* (staging: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const entry of (yield* fs.readDirectory(staging)).filter((entry) =>
    entry.startsWith("_"),
  )) {
    const hostDirectory = path.join(staging, entry);
    for (const scheme of yield* fs.readDirectory(hostDirectory)) {
      const nested = path.join(hostDirectory, scheme, entry.slice(1));
      if (scheme.endsWith("_") && (yield* fs.exists(nested))) {
        for (const child of yield* fs.readDirectory(nested))
          yield* fs.rename(
            path.join(nested, child),
            path.join(hostDirectory, child),
          );
        yield* fs.remove(path.join(hostDirectory, scheme), { recursive: true });
      }
    }
  }
});

const allFiles = Effect.fn(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop() ?? "";
    for (const entry of yield* fs
      .readDirectory(current)
      .pipe(Effect.orElseSucceed(() => []))) {
      const full = path.join(current, entry);
      const type = yield* fs.stat(full).pipe(
        Effect.map(({ type }) => type),
        Effect.orElseSucceed(() => "Other" as const),
      );
      if (type === "Directory") pending.push(full);
      else files.push(full);
    }
  }
  return files;
});

const repairHeading = (line: string) =>
  line.startsWith("#")
    ? line
        .replaceAll(/\\\\(?<name>\w+)\\\\/gu, "__$<name>__")
        .replaceAll(String.raw`\\`, "[]")
        .replaceAll(
          /\\(?<inner>[^\\|]*[ ,][^\\|]*)\\(?=[ \t]|$)/gu,
          "[$<inner>]",
        )
        .replaceAll(/\\(?<word>\w+)\\(?=[ \t]|$)/gu, "[$<word>]")
        .replaceAll(/\\(?=[A-Za-z0-9])/gu, "_")
        .replaceAll(/\\(?=[ \t]|$)/gu, "_")
    : line;

const repairCrawledMarkdown = Effect.fn(function* (staging: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const file of (yield* allFiles(staging)).filter((file) =>
    file.endsWith(".md"),
  )) {
    const before = yield* fs.readFileString(file);
    const after = before.split("\n").map(repairHeading).join("\n");
    if (after !== before) yield* fs.writeFileString(file, after);
  }
});

const crawlInto = Effect.fn(function* (staging: string, crawl: Crawl) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* assertCrawler;
  const exit = yield* spawner.exitCode(
    ChildProcess.make(
      CRAWLER,
      [
        `--url=${crawl.url}`,
        `--include-regex=${crawl.include}`,
        "--regex-filtering-only-for-pages",
        ...(crawl.browser
          ? [
              "--browser",
              "--browser-wait=networkidle",
              "--browser-wait-extra=3000",
              "--screenshot-viewport=1600x30000",
              "--browser-auto-download",
            ]
          : []),
        ...(crawl.externalFileDomain ?? []).map(
          (domain) => `--allowed-domain-for-external-files=${domain}`,
        ),
        ...(crawl.ignore ?? []).map((regex) => `--ignore-regex=${regex}`),
        ...(crawl.excludeSelector ?? []).map(
          (selector) => `--markdown-exclude-selector=${selector}`,
        ),
        `--markdown-export-dir=${staging}`,
        "--max-queue-length=100000",
        "--max-visited-urls=50000",
        "--workers=2",
        "--max-reqs-per-sec=3",
        "--output-html-report=",
        "--output-json-file=",
        "--output-text-file=",
      ],
      { stdout: "inherit", stderr: "inherit" },
    ),
  );
  if (exit !== 0)
    return yield* new RefsError({
      reason: `crawl of ${crawl.url} failed (exit ${String(exit)})`,
    });
  yield* flattenExternalAssets(staging);
  yield* repairCrawledMarkdown(staging);
});

interface TopicSlot {
  readonly into: string;
  readonly file: string;
  readonly anchor: string;
}

interface Chapter {
  readonly file: string;
  readonly entries: readonly {
    readonly node: TocNode;
    readonly anchor: string;
    readonly level: number;
  }[];
}

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

const topicAnchor = (prettyUrl: string) =>
  (prettyUrl.split("/").pop() ?? "").replace(/\.html$/u, "");

const uniqueName = (name: string, used: Set<string>) => {
  let candidate = name;
  for (let suffix = 2; used.has(candidate); suffix++)
    candidate = /\./u.test(name)
      ? name.replace(
          /(?<extension>\.[^.]+)$/u,
          `-${String(suffix)}$<extension>`,
        )
      : `${name}-${String(suffix)}`;
  used.add(candidate);
  return candidate;
};

const planMap = (toc: readonly TocNode[], into: string) => {
  const slots = new Map<string, TopicSlot>();
  const chapters: Chapter[] = [];
  const files = new Set<string>();
  for (const chapter of toc) {
    const file = uniqueName(`${slugify(chapter.title) || "topic"}.md`, files);
    const anchors = new Set<string>();
    const entries: Chapter["entries"][number][] = [];
    const walk = (node: TocNode, level: number) => {
      const anchor = uniqueName(
        topicAnchor(node.prettyUrl) || slugify(node.title),
        anchors,
      );
      entries.push({ node, anchor, level });
      slots.set(node.tocId, { into, file, anchor });
      for (const child of node.children) walk(child, Math.min(level + 1, 6));
    };
    walk(chapter, 1);
    chapters.push({ file, entries });
  }
  return { slots, chapters };
};

const shiftHeadings = (markdown: string, by: number) =>
  markdown.replaceAll(
    /^(?<hashes>#{1,6}) /gmu,
    (_, hashes: string) => `${"#".repeat(Math.min(hashes.length + by, 6))} `,
  );

const imagePattern = /<img\b[^>]*>/gu;
const dataSourcePattern =
  /src="data:image\/(?<extension>[a-z]+);base64,(?<data>[^"]*)"/u;
const assetNamePattern = /data-ft-asset-display-name="(?<name>[^"]*)"/u;
const tocIdPattern = /data-tocid="(?<tocId>[^"]+)"/u;
const internalLinkPattern =
  /<span\b(?<attributes>[^>]*\bft-internal-link\b[^>]*)>(?<text>[\s\S]*?)<\/span>/gu;
const keyboardPattern = /<kbd\b[^>]*>(?<text>[\s\S]*?)<\/kbd>/gu;

const prepareTopic = Effect.fn(function* (
  html: string,
  context: {
    readonly into: string;
    readonly slots: ReadonlyMap<string, TopicSlot>;
    readonly assetsDirectory: string;
    readonly assets: Map<string, string>;
    readonly assetNames: Set<string>;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rewrites = new Map<string, string>();
  for (const [tag] of html.matchAll(imagePattern)) {
    const data = dataSourcePattern.exec(tag);
    if (data !== null && !rewrites.has(tag)) {
      const bytes = Buffer.from(data.groups?.data ?? "", "base64");
      const digest = createHash("sha256").update(bytes).digest("hex");
      let name = context.assets.get(digest);
      if (name === undefined) {
        const displayName = assetNamePattern.exec(tag)?.groups?.name;
        name = uniqueName(
          displayName === undefined || displayName === ""
            ? `figure-${digest.slice(0, 8)}.${data.groups?.extension ?? "png"}`
            : displayName,
          context.assetNames,
        );
        context.assets.set(digest, name);
        yield* fs.writeFile(path.join(context.assetsDirectory, name), bytes);
      }
      rewrites.set(
        tag,
        tag.replace(dataSourcePattern, `src="../_assets/${name}"`),
      );
    }
  }
  return html
    .replaceAll(imagePattern, (tag) => rewrites.get(tag) ?? tag)
    .replaceAll(
      internalLinkPattern,
      (_match, attributes: string, text: string) => {
        const slot = context.slots.get(
          tocIdPattern.exec(attributes)?.groups?.tocId ?? "",
        );
        if (slot === undefined) return text;
        const href =
          slot.into === context.into
            ? `${slot.file}#${slot.anchor}`
            : `../${slot.into}/${slot.file}#${slot.anchor}`;
        return `<a href="${href}">${text}</a>`;
      },
    )
    .replaceAll(
      keyboardPattern,
      (_match, text: string) => `<code>${text}</code>`,
    );
});

const ftMeta = (
  metadata: readonly {
    readonly key: string;
    readonly values: readonly string[];
  }[],
  key: string,
) => metadata.find((entry) => entry.key === key)?.values[0];

const fluidTopicsInto = Effect.fn(function* (
  staging: string,
  fluidTopics: FluidTopics,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* assertCrawler;
  const catalogue = yield* Schema.decodeEffect(FtMaps)(
    yield* httpGet(`${fluidTopics.tenant}/api/khub/maps`),
  );
  const slots = new Map<string, TopicSlot>();
  const planned: {
    readonly into: string;
    readonly mapId: string;
    readonly chapters: readonly Chapter[];
  }[] = [];
  let resolvedVersion = fluidTopics.version;
  for (const wanted of fluidTopics.maps) {
    const matches = catalogue.filter(
      (map) =>
        map.title === wanted.title &&
        ftMeta(map.metadata, "version")?.startsWith(fluidTopics.version) ===
          true &&
        ftMeta(map.metadata, "ft:locale")?.startsWith(fluidTopics.locale) ===
          true,
    );
    if (matches.length !== 1)
      return yield* new RefsError({
        reason: `${String(matches.length)} maps titled "${wanted.title}" match ${fluidTopics.version} ${fluidTopics.locale} on ${fluidTopics.tenant}; expected exactly 1`,
      });
    const [map] = matches;
    resolvedVersion = ftMeta(map.metadata, "version") ?? fluidTopics.version;
    const toc = yield* Schema.decodeEffect(FtToc)(
      yield* httpGet(`${fluidTopics.tenant}/api/khub/maps/${map.id}/toc`),
    );
    const plan = planMap(toc, wanted.into);
    for (const [tocId, slot] of plan.slots) slots.set(tocId, slot);
    planned.push({
      into: wanted.into,
      mapId: map.id,
      chapters: plan.chapters,
    });
  }
  const assetsDirectory = path.join(staging, "_assets");
  yield* fs.makeDirectory(assetsDirectory, { recursive: true });
  const context = {
    slots,
    assetsDirectory,
    assets: new Map<string, string>(),
    assetNames: new Set<string>(),
  };
  const work = yield* fs.makeTempDirectory({ prefix: "refs-ft-" });
  const htmlPath = path.join(work, "topic.html");
  const markdownPath = path.join(work, "topic.md");
  const total = planned.reduce(
    (sum, map) =>
      sum +
      map.chapters.reduce(
        (count, chapter) => count + chapter.entries.length,
        0,
      ),
    0,
  );
  yield* Console.log(
    `  ${resolvedVersion}: ${String(total)} topics in ${String(planned.length)} map(s)`,
  );
  let done = 0;
  for (const map of planned) {
    yield* fs.makeDirectory(path.join(staging, map.into), { recursive: true });
    for (const chapter of map.chapters) {
      const parts: string[] = [];
      for (const { node, anchor, level } of chapter.entries) {
        const html = yield* httpGet(
          `${fluidTopics.tenant}/api/khub/maps/${map.mapId}/topics/${node.contentId}/content`,
        );
        yield* fs.writeFileString(
          htmlPath,
          yield* prepareTopic(html, { ...context, into: map.into }),
        );
        const exit = yield* spawner.exitCode(
          ChildProcess.make(
            CRAWLER,
            [
              `--html-to-markdown=${htmlPath}`,
              `--html-to-markdown-output=${markdownPath}`,
            ],
            { stdout: "ignore", stderr: "ignore" },
          ),
        );
        if (exit !== 0)
          return yield* new RefsError({
            reason: `converting "${node.title}" failed (exit ${String(exit)}); source at ${htmlPath}`,
          });
        parts.push(
          `${"#".repeat(level)} ${node.title}\n<a id="${anchor}"></a>\n\n${shiftHeadings((yield* fs.readFileString(markdownPath)).trim(), level)}`,
        );
        done++;
        if (done % 200 === 0)
          yield* Console.log(`  ${String(done)}/${String(total)} topics`);
      }
      yield* fs.writeFileString(
        path.join(staging, map.into, chapter.file),
        `${parts.join("\n\n")}\n`,
      );
    }
  }
  yield* fs.remove(work, { recursive: true, force: true });
  yield* Console.log(
    `  ${String(done)}/${String(total)} topics, ${String(context.assets.size)} images`,
  );
  return resolvedVersion;
});

const fillStaging = Effect.fn(function* (
  staging: string,
  ref: Ref,
  target: string,
) {
  if (ref.repo) return yield* downloadInto(staging, ref, ref.repo, target);
  if (ref.crawl) return yield* crawlInto(staging, ref.crawl);
  if (ref.fluidTopics) return yield* fluidTopicsInto(staging, ref.fluidTopics);
  return yield* new RefsError({ reason: `${ref.name} has no source` });
});

const sourceKind = (ref: Ref) => {
  if (ref.crawl) return "crawl";
  if (ref.fluidTopics) return "api";
  if (ref.branch) return "branch";
  return "pin";
};

const fetchRef = Effect.fn(function* ({
  ref,
  source,
  target,
  version,
}: ResolvedRef) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  yield* Console.log(
    `${ref.name}: ${source ? `${target} (${source})` : `${target} (${sourceKind(ref)})`}`,
  );
  const staging = yield* fs.makeTempDirectory({ prefix: `refs-${ref.name}-` });
  yield* Effect.gen(function* () {
    const reported = yield* fillStaging(staging, ref, target);
    const stamp = yield* Schema.encodeEffect(StampJson)({
      repo: ref.repo,
      url: ref.crawl?.url ?? ref.fluidTopics?.tenant,
      resolved: target,
      version: typeof reported === "string" ? reported : version,
      source,
      fetchedAt: new Date().toISOString(),
    });
    yield* fs.writeFileString(path.join(staging, ".ref.json"), `${stamp}\n`);
    const refDirectory = path.join(root, "refs", ref.name);
    yield* fs.makeDirectory(path.dirname(refDirectory), { recursive: true });
    yield* fs.remove(refDirectory, { recursive: true, force: true });
    yield* fs.rename(staging, refDirectory);
    yield* Console.log(`  -> refs/${ref.name}`);
  }).pipe(
    Effect.onError(() =>
      fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
    ),
  );
});

const checkRefs = Effect.gen(function* () {
  let stale = 0;
  for (const ref of REFS) {
    const resolved = yield* Effect.result(resolveRef(ref));
    const stamp = Result.isSuccess(resolved)
      ? yield* readStamp(ref.name)
      : undefined;
    if (Result.isFailure(resolved)) {
      yield* Console.log(
        `${ref.name.padEnd(nameColumn)} ERROR  ${resolved.failure.message}`,
      );
      stale++;
    } else if (stamp === undefined) {
      yield* Console.log(
        `${ref.name.padEnd(nameColumn)} MISSING  want ${resolved.success.target}`,
      );
      stale++;
    } else if (stamp.resolved !== resolved.success.target) {
      yield* Console.log(
        `${ref.name.padEnd(nameColumn)} STALE  have ${stamp.resolved}  want ${resolved.success.target}`,
      );
      stale++;
    } else if (resolved.success.version === undefined) {
      const days = Math.floor(
        (Date.now() - Date.parse(stamp.fetchedAt)) / 86_400_000,
      );
      yield* Console.log(
        `${ref.name.padEnd(nameColumn)} ${resolved.success.target}  fetched ${days === 0 ? "today" : `${String(days)}d ago`}`,
      );
    } else {
      yield* Console.log(
        `${ref.name.padEnd(nameColumn)} ok  ${resolved.success.version}`,
      );
    }
  }
  return stale;
});

const toUserError = (error: unknown) =>
  new CliError.UserError({
    cause: error,
    userMessage: error instanceof Error ? error.message : String(error),
  });

const fetchCommand = Command.make(
  "fetch",
  {
    all: Flag.boolean("all").pipe(
      Flag.withDescription("Fetch every ref except opt-in refs"),
      Flag.withDefault(false),
    ),
    names: Argument.choice("name", refNames).pipe(
      Argument.variadic(),
      Argument.withDescription("Refs to fetch"),
    ),
  },
  Effect.fn(function* ({ all, names }) {
    if (!all && names.length === 0)
      return yield* new CliError.UserError({
        cause: "no refs named",
        userMessage: "name refs to fetch, or pass --all",
      });
    const refs = all
      ? REFS.filter(({ optIn }) => !optIn)
      : REFS.filter(({ name }) => names.includes(name));
    const failed: string[] = [];
    for (const ref of refs) {
      yield* resolveRef(ref).pipe(
        Effect.flatMap(fetchRef),
        Effect.catch((error) =>
          Effect.gen(function* () {
            failed.push(ref.name);
            yield* Console.error(`${ref.name}: failed -- ${error.message}`);
          }),
        ),
      );
    }
    if (failed.length > 0)
      return yield* new CliError.UserError({
        cause: "fetch failed",
        userMessage: `failed to fetch: ${failed.join(", ")}`,
      });
  }),
).pipe(
  Command.withDescription(
    "Download refs into refs/, pinned to workspace versions",
  ),
);

const checkCommand = Command.make(
  "check",
  {},
  Effect.fn(function* () {
    const stale = yield* checkRefs.pipe(Effect.mapError(toUserError));
    if (stale > 0)
      return yield* new CliError.UserError({
        cause: "refs drifted",
        userMessage: `${String(stale)} ref(s) drifted from the pins`,
      });
  }),
).pipe(
  Command.withDescription("Report refs that drifted from pins; exit 1 if any"),
);

const listCommand = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    yield* checkRefs.pipe(Effect.mapError(toUserError));
  }),
).pipe(Command.withDescription("Report the status of every ref"));

const refsCommand = Command.make("refs").pipe(
  Command.withDescription("Manage pinned reference sources in refs/"),
  Command.withSubcommands([fetchCommand, checkCommand, listCommand]),
);

NodeRuntime.runMain(
  refsCommand.pipe(
    Command.run({ version: "0.0.0" }),
    Effect.provide(NodeServices.layer),
  ),
);
