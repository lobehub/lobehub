import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';

import { extractTranslationUses } from './extract';
import { addWorkspacePaths, traceServerGraph } from './graph';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const fixture = async (files: Record<string, string>) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'server-i18n-graph-'));
  directories.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
};
it('traces workspace exports, aliases and re-exports without pulling type-only resources', async () => {
  const root = await fixture({
    'entry.ts':
      "import { render } from '@example/copy'; render(); import type { Frontend } from './frontend';",
    'frontend.ts': "import './unresolvable'; export interface Frontend {}",
    'packages/copy/package.json': JSON.stringify({
      name: '@example/copy',
      exports: { '.': './src/index.ts' },
    }),
    'packages/copy/src/index.ts': "export { render } from './render';",
    'packages/copy/src/render.ts':
      "import { t } from '@/translation'; export const render = () => t('shared.key');",
    'translation.ts':
      "export declare const t: ((key: string) => string) & { __serverNamespace?: 'home' };",
  });
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noLib: true,
    paths: { '@/translation': [path.join(root, 'translation.ts')] },
  };
  await addWorkspacePaths(root, options);
  const graph = await traceServerGraph(root, [path.join(root, 'entry.ts')], options);
  expect(graph.files.map((file) => path.basename(file))).not.toContain('frontend.ts');
  const uses = extractTranslationUses(ts.createProgram(graph.files, options), graph.files);
  expect(uses).toEqual([
    expect.objectContaining({ namespace: 'home', patterns: ['shared\\.key'] }),
  ]);
});
it('fails on unresolved dynamic imports', async () => {
  const root = await fixture({ 'entry.ts': 'declare const name: string; import(`./${name}`);' });
  await expect(traceServerGraph(root, [path.join(root, 'entry.ts')], {})).rejects.toThrow(
    'Unresolved dynamic import',
  );
});
it('does not silently skip a workspace export that resolves only to declarations', async () => {
  const root = await fixture({
    'entry.ts': "import { render } from '@example/copy'; render();",
    'packages/copy/package.json': JSON.stringify({
      name: '@example/copy',
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
    }),
    'packages/copy/index.d.ts': 'export declare function render(): string;',
    'packages/copy/index.js': 'export const render = () => "copy";',
  });
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
  await addWorkspacePaths(root, options);
  await expect(traceServerGraph(root, [path.join(root, 'entry.ts')], options)).rejects.toThrow(
    'Cannot trace workspace runtime through a declaration file',
  );
});
it('rejects imports of unprojected locale catalogs', async () => {
  const root = await fixture({
    'entry.ts': "import home from '@/locales/default/home'; console.log(home);",
  });
  await expect(traceServerGraph(root, [path.join(root, 'entry.ts')], {})).rejects.toThrow(
    'unprojected locale',
  );
});

it('stops at client boundaries and follows literal lazy server imports', async () => {
  const root = await fixture({
    'entry.ts': "import './client'; export const lazy = () => import('./server');",
    'client.ts': "'use client'; import i18next from 'i18next'; i18next.t('frontend');",
    'server.ts': 'export const value = 1;',
  });
  const graph = await traceServerGraph(root, [path.join(root, 'entry.ts')], {});
  expect(graph.clientBoundaries.map((file) => path.basename(file))).toEqual(['client.ts']);
  expect(graph.files.map((file) => path.basename(file)).sort()).toEqual(['entry.ts', 'server.ts']);
});

it('accepts app-local declarations for assets generated later in the build', async () => {
  const root = await fixture({
    'entry.ts': 'export const page = () => import("./src/app/htmlTemplate");',
    'src/app/htmlTemplate.d.ts': 'export declare const htmlTemplate: string;',
  });
  const graph = await traceServerGraph(root, [path.join(root, 'entry.ts')], {});
  expect(graph.files.map((file) => path.basename(file))).toEqual(['entry.ts']);
});

it('rejects app-local runtime declarations that could hide translation calls', async () => {
  const root = await fixture({
    'entry.ts': 'export { render } from "./src/render";',
    'src/render.d.ts': 'export declare function render(): string;',
  });
  await expect(traceServerGraph(root, [path.join(root, 'entry.ts')], {})).rejects.toThrow(
    'Cannot trace workspace runtime',
  );
});

it('resolves declared workspace aliases even when installed links point at a stub', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({
      dependencies: { '@example/copy': 'workspace:@example/implementation@*' },
    }),
    'entry.ts': "export { render } from '@example/copy/details';",
    'node_modules/@example/copy/package.json': JSON.stringify({
      name: '@example/copy',
      exports: { '.': './index.ts' },
    }),
    'node_modules/@example/copy/index.ts': 'export {};',
    'packages/copy/package.json': JSON.stringify({
      name: '@example/implementation',
      exports: { './details': { default: './src/details.ts' } },
    }),
    'packages/copy/src/details.ts': 'export const render = () => "copy";',
  });
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
  await addWorkspacePaths(root, options);
  const graph = await traceServerGraph(root, [path.join(root, 'entry.ts')], options);
  expect(graph.files.map((file) => path.basename(file))).toContain('details.ts');
});
