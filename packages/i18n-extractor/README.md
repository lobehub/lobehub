# @lobechat/i18n-extractor

Static extraction of the translation keys a TypeScript program can reach. Starting from entry files, it follows runtime imports, finds calls to namespace-branded translators with the type checker, derives the key patterns each call can produce, and projects only the matching keys out of your catalogs.

It fails instead of guessing: opaque keys, erased translator types, unresolved local imports, runtime code hidden behind declaration files, and forbidden imports all stop extraction.

## Marker convention

A translator is any function whose type carries the phantom `__i18nNamespace` property. The property never exists at runtime; it only lets the checker see the namespace through aliases, callbacks, destructuring and package boundaries.

```ts
import type { NamespacedTranslate } from '@lobechat/i18n-extractor/marker';

export interface Translator<N extends string> {
  find: NamespacedTranslate<N, string | undefined>;
  t: NamespacedTranslate<N>;
}
```

- `NamespaceMarker<N>`: `{ readonly __i18nNamespace?: N }`.
- `Namespaced<N, F>`: `F & NamespaceMarker<N>`.
- `NamespacedTranslate<N, Result = string, Options = Record<string, unknown>>`: a branded `(key, options?) => Result`.

### i18next

i18next already brands its `TFunction` with `$TFunctionBrand` once `CustomTypeOptions.resources` is declared. The analysis program includes every declaration file of the tsconfig; list one it does not include in `declarations`, or the brand loses its namespace and extraction fails with `unknown translation namespace`. Pass `i18nextPreset` as the extract options:

```ts
import { extractI18n, i18nextPreset } from '@lobechat/i18n-extractor';

await extractI18n({ ...config, extract: i18nextPreset });
```

It sets `marker: '$TFunctionBrand'`, `translatorFields: ['t']`, `namespaceOption: 'ns'` (`t(key, { ns: 'topic' })` records `topic`; an omittable option also keeps the branded namespace) `namespaceSeparator: ':'` (`t('error:title')` records `error` / `title`), `countOption: 'count'` and `contextOption: 'context'`. A non-string `count` also retains `key_<category>` and `key_ordinal_<category>` for every plural category, and a `context` retains `key_<context>` (combined with the plural suffixes when both are passed), so each language keeps whichever forms its catalog has. `pluralSeparator` and `contextSeparator` default to `_`. i18next brands only the first namespace of `useTranslation(['a', 'b'])`, so reach the others through the option or the prefix.

### Calls

Calls whose result type includes `undefined` (such as `find`) are optional: their keys need not exist in the default catalog. Passing a branded translator, or an object whose `t`/`find` fields are branded, into a type without the marker fails with `namespace erased`. `t.call`, `t.apply` and `t.bind` are rejected. A translator listed in an `unknown`-typed array, such as a hook dependency list, is a reference and not an erasure.

## Key patterns

| Key expression                                                        | Retained keys                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| `'title'`, `const key = 'title'`                                      | exactly `title`                                      |
| `key: 'a' \| 'b'`, `` key: `level.${'low' \| 'high'}` ``              | each member                                          |
| `` `status.${reason}` `` with `reason: 'safety' \| undefined`         | `status.safety` and `status.undefined`               |
| `key as any`, `key!`, `(key)`, `key satisfies K`                      | whatever the inner expression retains                |
| `` `status.${code}` `` with `code: string` (or any non-literal value) | every key matching `status\..*`                      |
| `key: string`                                                         | the whole namespace, only with a `dynamicKeys` entry |
| `t('views', { count })`                                               | `views` and `views_<plural category>`                |
| `t('friend', { context: 'male' \| 'female' })`                        | `friend`, `friend_male`, `friend_female`             |
| `key: any`, `unknown`, objects                                        | rejected                                             |

## Orchestrator

```ts
import { extractI18n, isUseClientBoundary } from '@lobechat/i18n-extractor';

const { resources, report } = await extractI18n({
  root: '/repo',
  entries: ['src/server.ts'],
  catalog: {
    defaultLanguage: 'en-US',
    languages: () => readLanguages(),
    load: (language, namespace) => readCatalog(language, namespace),
  },
  dynamicKeys: [
    { file: 'src/errors.ts', namespace: 'error', reason: 'Codes arrive from the provider' },
  ],
  graph: { forbiddenImports: [/locales\/.*\.json$/], isBoundary: isUseClientBoundary },
});
```

| Option         | Meaning                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `root`         | Project root; `entries`, `tsconfig`, `dynamicKeys[].file` and report paths are relative to it.                                                                                                                                                               |
| `entries`      | Files the graph starts from. `listSourceFiles(dir)` helps discover them.                                                                                                                                                                                     |
| `catalog`      | `defaultLanguage`, `languages` (array or sync/async function) and `load(language, namespace)` returning a flat `Record<string, string>`. Return `{}` for a missing translation.                                                                              |
| `dynamicKeys`  | Allowlist for unbounded keys, matched by file and namespace. `reason` is required; a missing file fails.                                                                                                                                                     |
| `tsconfig`     | Defaults to `tsconfig.json`. `compilerOptions` overrides the parsed options. Its declaration files join the analysis program.                                                                                                                                |
| `declarations` | Extra declaration files for the analysis program, such as an i18next `CustomTypeOptions` augmentation the tsconfig does not include. A missing file fails.                                                                                                   |
| `workspace`    | `{ packagesDirs }` (default `['packages']`) for `addWorkspacePaths`, or `false` to disable.                                                                                                                                                                  |
| `graph`        | `forbiddenImports`, `isBoundary`, `skip`, `mustResolve`; see `traceImportGraph`.                                                                                                                                                                             |
| `extract`      | `marker` (default `__i18nNamespace`), `translatorFields` (default `['t', 'find']`), `namespaceOption`, `namespaceSeparator`, `countOption`, `contextOption`, `skip` for files that implement the translator itself. `i18nextPreset` fills these for i18next. |
| `allowEmpty`   | Allow a result with no translation calls.                                                                                                                                                                                                                    |

Every non-optional pattern must match at least one default-language key. `resources` has the shape `{ [language]: { [namespace]: { [key]: value } } }` for the default language plus every listed language. `report` records the traced file count, boundaries, import edges, call sites with their patterns, and per-namespace key counts, with paths relative to `root`.

## Building blocks

- `traceImportGraph({ root, entries, compilerOptions, forbiddenImports?, isBoundary?, skip?, mustResolve? })` transpiles each file before scanning, so type-only imports never enter the graph. Literal `import()` and `require()` are followed; non-literal ones fail. `node_modules` is not traced. A resolved declaration file fails unless it only declares string constants (a generated text asset). `forbiddenImports` is tested against both the specifier and the resolved real path. By default relative, absolute and `paths`-mapped specifiers must resolve, except asset extensions and `?query` imports. Use `skip` for generated modules.
- `isUseClientBoundary` and `hasDirective(sourceFile, directive)` build boundary predicates. Boundary files are excluded from the graph and from the type-checking program.
- `addWorkspacePaths(root, compilerOptions, { packagesDirs })` maps workspace packages to their source `exports` when they are not linked in `node_modules`, plus `workspace:<name>@<range>` aliases declared in the root manifest's `dependencies`, `overrides` or `pnpm.overrides`.
- `extractTranslationUses(program, files, options)`, `typePatterns(type)`, `selectKeys(keys, patterns)`, `assertBoundedTranslationUses(uses, allowlist)`.
- `renderResourcesModule(resources, exportName?)` and `writeIfChanged(file, content)`.

## CLI

```sh
bun packages/i18n-extractor/src/bin.ts --config i18n.config.ts
node --import tsx packages/i18n-extractor/src/bin.ts --config i18n.config.ts
```

Dependents also get an `i18n-extract` bin. The config module default-exports the `extractI18n` options plus output settings, or a function returning them:

```ts
import { defineConfig } from '@lobechat/i18n-extractor';

export default defineConfig({
  entries: ['src/server.ts'],
  catalog: { defaultLanguage: 'en', languages: ['de'], load: loadCatalog },
  output: 'src/generated/i18n.js',
  report: 'src/generated/i18n-report.json',
});
```

`root` defaults to the config file's directory, and `output` and `report` resolve against it. The output is an ES module exporting `resources` (rename with `exportName`). Both files are written only when their content changes.

## Tests

```sh
cd packages/i18n-extractor && bunx vitest run --silent='passed-only'
```
