import { realpath } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

import type { DynamicKeyEntry, ExtractTranslationUsesOptions, TranslationUse } from './extract';
import { assertBoundedTranslationUses, extractTranslationUses, selectKeys } from './extract';
import type {
  AddWorkspacePathsOptions,
  ImportEdge,
  ImportGraph,
  TraceImportGraphOptions,
} from './graph';
import { addWorkspacePaths, traceImportGraph } from './graph';

export type Catalog = Record<string, string>;

export type Resources = Record<string, Record<string, Catalog>>;

export interface CatalogAdapter {
  defaultLanguage: string;
  languages: string[] | (() => Promise<string[]> | string[]);
  load: (language: string, namespace: string) => Promise<Catalog> | Catalog;
}

export interface ExtractI18nConfig {
  allowEmpty?: boolean;
  catalog: CatalogAdapter;
  compilerOptions?: ts.CompilerOptions;
  declarations?: string[];
  dynamicKeys?: DynamicKeyEntry[];
  entries: string[];
  extract?: ExtractTranslationUsesOptions;
  graph?: Pick<TraceImportGraphOptions, 'forbiddenImports' | 'isBoundary' | 'mustResolve' | 'skip'>;
  root: string;
  tsconfig?: string;
  workspace?: AddWorkspacePathsOptions | false;
}

export interface I18nReport {
  boundaries: string[];
  files: number;
  imports: ImportEdge[];
  namespaces: Record<string, number>;
  uses: TranslationUse[];
}

export interface ExtractI18nResult {
  report: I18nReport;
  resources: Resources;
}

const readTsconfig = (file: string) => {
  const config = ts.readConfigFile(file, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(file));
  return {
    declarations: parsed.fileNames.filter((name) => DECLARATION_FILE.test(name)),
    options: parsed.options,
  };
};

const DECLARATION_FILE = /\.d\.[cm]?ts$/;

const createAnalysisProgram = (
  graph: ImportGraph,
  compilerOptions: ts.CompilerOptions,
  declarations: string[],
) => {
  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  const boundaries = new Set(graph.boundaries);
  // Boundary modules resolve as missing so the checker never loads the graph behind them.
  host.getSourceFile = (file, ...args) =>
    boundaries.has(file) ? undefined : getSourceFile(file, ...args);
  // Ambient declarations (module augmentation, globals) type the translators but are never imported.
  return ts.createProgram(
    [...new Set([...graph.files, ...declarations])],
    { ...compilerOptions, noEmit: true },
    host,
  );
};

const pick = (values: Catalog, patterns: string[]) =>
  Object.fromEntries(selectKeys(Object.keys(values), patterns).map((key) => [key, values[key]]));

export const extractI18n = async (config: ExtractI18nConfig): Promise<ExtractI18nResult> => {
  const root = await realpath(config.root);
  const tsconfig = readTsconfig(path.resolve(root, config.tsconfig ?? 'tsconfig.json'));
  const compilerOptions: ts.CompilerOptions = { ...tsconfig.options, ...config.compilerOptions };
  const declarations = [
    ...tsconfig.declarations,
    ...(await Promise.all(
      (config.declarations ?? []).map((file) => realpath(path.resolve(root, file))),
    )),
  ];
  if (config.workspace !== false) await addWorkspacePaths(root, compilerOptions, config.workspace);
  const graph = await traceImportGraph({
    ...config.graph,
    compilerOptions,
    entries: config.entries,
    root,
  });
  const uses = extractTranslationUses(
    createAnalysisProgram(graph, compilerOptions, declarations),
    graph.files,
    config.extract,
  );
  const dynamicKeys = await Promise.all(
    (config.dynamicKeys ?? []).map(async (entry) => {
      if (!entry.reason?.trim())
        throw new Error(
          `Dynamic translation key entry ${entry.file} (${entry.namespace}) requires a reason`,
        );
      return { ...entry, file: await realpath(path.resolve(root, entry.file)) };
    }),
  );
  assertBoundedTranslationUses(uses, dynamicKeys);
  if (!uses.length && !config.allowEmpty)
    throw new Error('No translation calls found; refusing to emit empty resources');

  const { catalog } = config;
  const namespaces = [...new Set(uses.map((use) => use.namespace))].sort();
  const defaults: Record<string, Catalog> = {};
  for (const namespace of namespaces)
    defaults[namespace] = await catalog.load(catalog.defaultLanguage, namespace);
  for (const use of uses) {
    if (use.optional) continue;
    const keys = Object.keys(defaults[use.namespace]);
    for (const pattern of use.patterns)
      if (!selectKeys(keys, [pattern]).length)
        throw new Error(
          `${use.file}:${use.line}: no ${catalog.defaultLanguage} translation matches ${use.namespace}:${pattern}`,
        );
  }
  const patterns = Object.fromEntries(
    namespaces.map((namespace) => [
      namespace,
      [
        ...new Set(
          uses.filter((use) => use.namespace === namespace).flatMap((use) => use.patterns),
        ),
      ],
    ]),
  );
  const listed =
    typeof catalog.languages === 'function' ? await catalog.languages() : catalog.languages;
  const languages = [...new Set([catalog.defaultLanguage, ...listed])].sort();
  const resources: Resources = {};
  for (const language of languages) {
    resources[language] = {};
    for (const namespace of namespaces) {
      const values =
        language === catalog.defaultLanguage
          ? defaults[namespace]
          : await catalog.load(language, namespace);
      resources[language][namespace] = pick(values, patterns[namespace]);
    }
  }

  const relative = (file: string) => path.relative(root, file);
  return {
    report: {
      boundaries: graph.boundaries.map(relative),
      files: graph.files.length,
      imports: graph.imports.map((edge) => ({
        ...edge,
        from: relative(edge.from),
        to: relative(edge.to),
      })),
      namespaces: Object.fromEntries(
        namespaces.map((namespace) => [
          namespace,
          Object.keys(resources[catalog.defaultLanguage][namespace]).length,
        ]),
      ),
      uses: uses.map((use) => ({ ...use, file: relative(use.file) })),
    },
    resources,
  };
};
