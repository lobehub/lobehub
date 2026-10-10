import { mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { assertBoundedTranslationUses, extractTranslationUses, selectKeys } from './extract';
import { addWorkspacePaths, sourceFiles, traceServerGraph } from './graph';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const writeIfChanged = async (file: string, content: string) => {
  try {
    if ((await readFile(file, 'utf8')) === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, file);
};

export const generateServerI18n = async (root = repoRoot, sourceRoot = repoRoot) => {
  root = await realpath(root);
  sourceRoot = await realpath(sourceRoot);
  // TypeScript's config and module resolver require a synchronous host.
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  await addWorkspacePaths(root, options);
  const generated = path.join(sourceRoot, 'src/libs/i18n/server/generated');
  await mkdir(generated, { recursive: true });
  // Keep analysis independent of stale generated types and expose only a stable resource contract.
  await writeIfChanged(
    path.join(generated, 'resources.d.ts'),
    "import type { ServerResources } from '../render';\n\nexport declare const serverResources: ServerResources;\n",
  );
  const appFiles = await sourceFiles(path.join(root, 'src/app'));
  const entries = appFiles.filter((file) =>
    /\/(?:route|metadata|seoMeta|page|layout|default|template|not-found|error|global-error|loading)\.tsx?$/.test(
      file,
    ),
  );
  entries.push(path.join(sourceRoot, 'apps/server/src/router-hono/standalone.ts'));
  const graph = await traceServerGraph(root, entries, options);
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const clientBoundaries = new Set(graph.clientBoundaries);
  host.getSourceFile = (file, ...args) =>
    clientBoundaries.has(file) ? undefined : getSourceFile(file, ...args);
  const program = ts.createProgram(graph.files, { ...options, noEmit: true }, host);
  const uses = extractTranslationUses(program, graph.files);
  let configurationText: string | undefined;
  try {
    configurationText = await readFile(path.join(root, 'server-i18n.config.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const configuration = configurationText
    ? (JSON.parse(configurationText) as {
        dynamicKeys?: { file: string; namespace: string; reason: string }[];
      })
    : {};
  const applicationAllowlist = await Promise.all(
    (configuration.dynamicKeys ?? []).map(async (entry) => {
      if (!entry.reason?.trim()) throw new Error('Dynamic translation keys require a reason');
      return { ...entry, file: await realpath(path.resolve(root, entry.file)) };
    }),
  );
  assertBoundedTranslationUses(uses, [
    ...applicationAllowlist,
    {
      file: path.join(sourceRoot, 'apps/server/src/services/taskLifecycle/index.ts'),
      namespace: 'runtimeError',
      reason: 'Provider error codes arrive at runtime; retain the dedicated runtime error catalog.',
    },
  ]);
  if (!uses.length)
    throw new Error('No server translation calls found; refusing to emit an empty bundle');
  const namespaces = [...new Set(uses.map((use) => use.namespace))].sort();
  const defaults: Record<string, Record<string, string>> = {};
  for (const ns of namespaces)
    defaults[ns] = (
      await import(
        pathToFileURL(path.join(sourceRoot, `packages/locales/src/default/${ns}.ts`)).href
      )
    ).default;
  const patterns = Object.fromEntries(
    namespaces.map((ns) => [
      ns,
      [...new Set(uses.filter((use) => use.namespace === ns).flatMap((use) => use.patterns))],
    ]),
  );
  for (const use of uses)
    for (const pattern of use.patterns) {
      if (!use.optional && !selectKeys(Object.keys(defaults[use.namespace]), [pattern]).length)
        throw new Error(
          `${use.file}:${use.line}: no default translation matches ${use.namespace}:${pattern}`,
        );
    }
  const resources: Record<string, Record<string, Record<string, string>>> = {};
  const languages = (await readdir(path.join(sourceRoot, 'locales'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const language of languages) {
    const catalog: Record<string, Record<string, string>> = {};
    for (const ns of namespaces) {
      let values = defaults[ns];
      if (language !== 'en-US') {
        try {
          values = JSON.parse(
            await readFile(path.join(sourceRoot, `locales/${language}/${ns}.json`), 'utf8'),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          values = {};
        }
      }
      catalog[ns] = Object.fromEntries(
        selectKeys(Object.keys(values), patterns[ns]).map((key) => [key, values[key]]),
      );
    }
    resources[language] = catalog;
  }
  const output = `// Generated by scripts/serverI18n/generate.ts. Do not edit.\nexport const serverResources = ${JSON.stringify(resources)};\n`;
  await writeIfChanged(path.join(generated, 'resources.js'), output);
  const report = {
    bytes: Buffer.byteLength(output),
    files: graph.files.length,
    namespaces: Object.fromEntries(
      namespaces.map((ns) => [ns, Object.keys(resources['en-US'][ns]).length]),
    ),
    uses: uses.map((use) => ({ ...use, file: path.relative(root, use.file) })),
    imports: graph.imports.map((edge) => ({
      ...edge,
      from: path.relative(root, edge.from),
      to: path.relative(root, edge.to),
    })),
  };
  await writeIfChanged(path.join(generated, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.info(
    'Server i18n:',
    JSON.stringify({ bytes: report.bytes, files: report.files, namespaces: report.namespaces }),
  );
  return report;
};
