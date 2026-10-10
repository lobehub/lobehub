# Server translation bundles

`bun run i18n:server` generates ignored resources under
`src/libs/i18n/server/generated/` (the stable type declaration is committed so a
fresh checkout can type-check before its first build). Next and standalone Hono builds run this step
before bundling; their development servers regenerate when source or locale files
change. CI generates fresh resources before tests. Generated resources are not
translation sources: edit `packages/locales/src/default/` and the locale JSON files.

Applications embedding this repository must call `prepareServerI18n(applicationRoot)`
from their own build configuration and await `watchServerI18n(applicationRoot)` in
development. The application root supplies entry points and TypeScript overrides;
the embedded source root supplies the catalogs, allowlist, and generated output.
The watcher covers both roots. Merely importing the shared Next config helper
does not install these hooks. Also exclude the embedded `locales/` directory and
`src/libs/i18n/server/generated/report.json` from the application's runtime traces.

Use `getServerTranslations(namespace, locale)` from `@/libs/i18n/serverTranslation`.
It returns `t`, which falls back to the key, and `find`, which returns `undefined`
when neither the requested language nor English has a value. Callers with their own
missing-key fallback can pass `{ fallbackToDefault: false }` as the third argument. Both interpolate
parameters; English fallback is enabled by default. The async `translation`
wrapper remains available for existing callers.

The extractor follows runtime imports from Next entry points and the standalone
Hono entry, including workspace packages and re-exports. Type-only imports and
client boundaries are excluded. Pass translators using `ServerTranslate<N>` so
their namespace remains visible to the compiler.

- Literal keys and finite unions retain exactly their matching keys.
- Templates such as `response.${code}` retain every key matching that pattern.
- An unrestricted string requires a file/namespace allowlist entry in
  `generate.ts`, with a reason. Wrapping applications can register their own calls
  in `server-i18n.config.json`: `dynamicKeys` is an array of `{ file, namespace,
  reason }` entries, with paths relative to the application root. The runtime error-code lookup is registered there.
- Opaque keys, erased translator types, unresolved local imports, and direct
  imports of unprojected translations fail generation.

`report.json` records selected namespaces, call sites, patterns, and dependency
edges. English is taken from the default TypeScript catalog; missing translated
keys fall back at runtime.

Run extractor tests with
`bunx vitest run --config scripts/serverI18n/vitest.config.ts`.
After a Next build, `bun run i18n:server:audit` checks seven backend route traces
for raw dictionaries and a 250 MiB local byte budget (the byte budget is skipped
for Docker). Source maps, when present, also detect embedded raw dictionaries.
Local NFT sizes do not replace verification of the final Vercel deployment bundle.

Extraction runs in a separate Node process with a 6 GiB heap limit. It validates
the complete runtime import graph and preserves full translation analysis while
avoiding redundant type queries for expressions without a contextual type. CI
generates one artifact per workflow run for all test shards, rather than extracting
per shard.
