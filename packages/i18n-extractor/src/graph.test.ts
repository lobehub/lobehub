import path from 'node:path';

import ts from 'typescript';
import { expect, it } from 'vitest';

import { extractTranslationUses } from './extract';
import { addWorkspacePaths, isUseClientBoundary, listSourceFiles, traceImportGraph } from './graph';
import { createFixture } from './testUtils';

const names = (files: string[]) => files.map((file) => path.basename(file)).sort();

it('traces workspace exports, aliases and re-exports without pulling type-only imports', async () => {
  const root = await createFixture({
    'entry.ts':
      "import { render } from '@example/copy'; render(); import type { Frontend } from './frontend';",
    'frontend.ts': "import './unresolvable'; export interface Frontend {}",
    'packages/copy/package.json': JSON.stringify({
      exports: { '.': './src/index.ts' },
      name: '@example/copy',
    }),
    'packages/copy/src/index.ts': "export { render } from './render';",
    'packages/copy/src/render.ts':
      "import { t } from '@/translation'; export const render = () => t('shared.key');",
    'translation.ts':
      "export declare const t: ((key: string) => string) & { __i18nNamespace?: 'home' };",
  });
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    paths: { '@/translation': [path.join(root, 'translation.ts')] },
    strict: true,
  };
  await addWorkspacePaths(root, compilerOptions);
  const graph = await traceImportGraph({ compilerOptions, entries: ['entry.ts'], root });
  expect(names(graph.files)).not.toContain('frontend.ts');
  const uses = extractTranslationUses(ts.createProgram(graph.files, compilerOptions), graph.files);
  expect(uses).toEqual([
    expect.objectContaining({ namespace: 'home', patterns: ['shared\\.key'] }),
  ]);
});

it('looks up workspace packages in configurable directories', async () => {
  const root = await createFixture({
    'entry.ts': "export { render } from '@example/lib';",
    'libs/nested/lib/package.json': JSON.stringify({
      exports: './src/index.ts',
      name: '@example/lib',
    }),
    'libs/nested/lib/src/index.ts': 'export const render = () => "copy";',
  });
  const compilerOptions: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
  await addWorkspacePaths(root, compilerOptions);
  expect(compilerOptions.paths).toBeUndefined();
  await addWorkspacePaths(root, compilerOptions, { packagesDirs: ['libs'] });
  const graph = await traceImportGraph({ compilerOptions, entries: ['entry.ts'], root });
  expect(names(graph.files)).toEqual(['entry.ts', 'index.ts']);
});

it('fails on unresolved dynamic imports', async () => {
  const root = await createFixture({
    'entry.ts': 'declare const name: string; import(`./${name}`);',
  });
  await expect(
    traceImportGraph({ compilerOptions: {}, entries: ['entry.ts'], root }),
  ).rejects.toThrow('Unresolved dynamic import');
});

it('fails on unresolved local imports but tolerates assets', async () => {
  const root = await createFixture({
    'asset.ts': "import './styles.css'; import './raw.ts?raw'; import 'external-package';",
    'entry.ts': "import './missing';",
  });
  await expect(
    traceImportGraph({ compilerOptions: {}, entries: ['entry.ts'], root }),
  ).rejects.toThrow('Unresolved import');
  const graph = await traceImportGraph({ compilerOptions: {}, entries: ['asset.ts'], root });
  expect(names(graph.files)).toEqual(['asset.ts']);
});

it('does not silently skip a workspace export that resolves only to declarations', async () => {
  const root = await createFixture({
    'entry.ts': "import { render } from '@example/copy'; render();",
    'packages/copy/index.d.ts': 'export declare function render(): string;',
    'packages/copy/index.js': 'export const render = () => "copy";',
    'packages/copy/package.json': JSON.stringify({
      exports: { '.': { default: './index.js', types: './index.d.ts' } },
      name: '@example/copy',
    }),
  });
  const compilerOptions: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
  await addWorkspacePaths(root, compilerOptions);
  await expect(traceImportGraph({ compilerOptions, entries: ['entry.ts'], root })).rejects.toThrow(
    'Cannot trace runtime through a declaration file',
  );
});

it('rejects forbidden imports by specifier and by resolved file', async () => {
  const root = await createFixture({
    'catalog/home.ts': 'export default { title: "Home" };',
    'direct.ts': "import home from '@/locales/default/home'; console.log(home);",
    'indirect.ts': "import home from './catalog/home'; console.log(home);",
  });
  const options = {
    compilerOptions: {},
    forbiddenImports: [/locales\/default/, /\/catalog\//],
    root,
  };
  await expect(traceImportGraph({ ...options, entries: ['direct.ts'] })).rejects.toThrow(
    'Forbidden import',
  );
  await expect(traceImportGraph({ ...options, entries: ['indirect.ts'] })).rejects.toThrow(
    'Forbidden import',
  );
});

it('stops at client boundaries and follows literal lazy imports', async () => {
  const root = await createFixture({
    'client.ts': "'use client'; import i18next from 'i18next'; i18next.t('frontend');",
    'entry.ts':
      "import './client'; export const lazy = () => import('./server'); const legacy = require('./legacy');",
    'legacy.ts': 'export const value = 2;',
    'server.ts': 'export const value = 1;',
  });
  const graph = await traceImportGraph({
    compilerOptions: {},
    entries: ['entry.ts'],
    isBoundary: isUseClientBoundary,
    root,
  });
  expect(names(graph.boundaries)).toEqual(['client.ts']);
  expect(names(graph.files)).toEqual(['entry.ts', 'legacy.ts', 'server.ts']);
});

it('skips configured files such as generated output', async () => {
  const root = await createFixture({
    'entry.ts': "import { resources } from './generated/resources'; console.log(resources);",
    'generated/resources.d.ts': 'export declare const resources: Record<string, unknown>;',
    'generated/resources.js': 'export const resources = {};',
  });
  const options = { compilerOptions: {}, entries: ['entry.ts'], root };
  await expect(traceImportGraph(options)).rejects.toThrow('declaration file');
  const graph = await traceImportGraph({
    ...options,
    skip: (file) => file.includes(`${path.sep}generated${path.sep}`),
  });
  expect(names(graph.files)).toEqual(['entry.ts']);
});

it('accepts declarations for text assets generated later in the build', async () => {
  const root = await createFixture({
    'entry.ts': 'export const page = () => import("./src/app/htmlTemplate");',
    'src/app/htmlTemplate.d.ts': 'export declare const htmlTemplate: string;',
  });
  const graph = await traceImportGraph({ compilerOptions: {}, entries: ['entry.ts'], root });
  expect(names(graph.files)).toEqual(['entry.ts']);
});

it('rejects runtime declarations that could hide translation calls', async () => {
  const root = await createFixture({
    'entry.ts': 'export { render } from "./src/render";',
    'src/render.d.ts': 'export declare function render(): string;',
  });
  await expect(
    traceImportGraph({ compilerOptions: {}, entries: ['entry.ts'], root }),
  ).rejects.toThrow('Cannot trace runtime');
});

it('resolves declared workspace aliases even when installed links point at a stub', async () => {
  const root = await createFixture({
    'entry.ts': "export { render } from '@example/copy/details';",
    'node_modules/@example/copy/index.ts': 'export {};',
    'node_modules/@example/copy/package.json': JSON.stringify({
      exports: { '.': './index.ts' },
      name: '@example/copy',
    }),
    'package.json': JSON.stringify({
      dependencies: { '@example/copy': 'workspace:@example/implementation@*' },
    }),
    'packages/copy/package.json': JSON.stringify({
      exports: { './details': { default: './src/details.ts' } },
      name: '@example/implementation',
    }),
    'packages/copy/src/details.ts': 'export const render = () => "copy";',
  });
  const compilerOptions: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
  await addWorkspacePaths(root, compilerOptions);
  const graph = await traceImportGraph({ compilerOptions, entries: ['entry.ts'], root });
  expect(names(graph.files)).toContain('details.ts');
});

it('lists source files without tests, declarations or ignored directories', async () => {
  const root = await createFixture({
    'src/a.ts': '',
    'src/b.test.ts': '',
    'src/c.d.ts': '',
    'src/dist/d.ts': '',
    'src/nested/e.tsx': '',
    'src/notes.md': '',
  });
  expect(names(await listSourceFiles(path.join(root, 'src')))).toEqual(['a.ts', 'e.tsx']);
});
