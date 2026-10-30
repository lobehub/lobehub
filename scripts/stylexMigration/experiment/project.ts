import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import react from '@vitejs/plugin-react';
import { build, type Plugin } from 'vite';

import { lobeIconImports } from '../../../plugins/vite/lobeIconImports';
import { lobeUiImports } from '../../../plugins/vite/lobeUiImports';
import { stylexPlugin } from '../../../plugins/vite/stylex';
import { baselineRef, componentSources } from './fixtures';

const execute = promisify(execFile);
export const repoRoot = path.resolve(import.meta.dirname, '../../..');

export const git = async (...args: string[]) =>
  (await execute('git', args, { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 })).stdout.trimEnd();

export const prepareProject = async (runDirectory: string) => {
  const started = performance.now();
  const sources: Record<string, string> = {};
  const revisions: Record<string, string> = {};
  const refs = [baselineRef, ...new Set(Object.values(componentSources).map(([ref]) => ref))];
  for (const ref of refs) revisions[ref] = await git('rev-parse', ref);
  for (const side of ['before', 'after']) {
    const directories = new Map<string, Set<string>>();
    for (const [name, [headRef, entry]] of Object.entries(componentSources)) {
      const ref = side === 'before' ? baselineRef : headRef;
      const directory = path.dirname(entry);
      const group = directories.get(ref) ?? new Set<string>();
      group.add(directory);
      directories.set(ref, group);
      sources[`${side}:${name}`] = path.join(runDirectory, side, 'sources', entry);
    }
    for (const [ref, paths] of directories) {
      const files = (await git('ls-tree', '-r', '--name-only', revisions[ref], '--', ...paths))
        .split('\n')
        .filter(Boolean);
      for (const file of files) {
        if (file.includes('.test.') || file.includes('/__tests__/')) continue;
        const target = path.join(runDirectory, side, 'sources', file);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, await git('show', `${revisions[ref]}:${file}`));
      }
    }
  }
  const dependencyInputs = ['package.json', 'node_modules/.modules.yaml'];
  const dependencyFiles = await Promise.all(
    dependencyInputs.map((file) => readFile(path.join(repoRoot, file))),
  );
  const installedVersions: Record<string, string> = {};
  for (const name of [
    '@lobehub/ui',
    '@stylexjs/stylex',
    '@playwright/test',
    'vite',
    'react',
    'happy-dom',
  ]) {
    const metadata = JSON.parse(
      await readFile(path.join(repoRoot, 'node_modules', name, 'package.json'), 'utf8'),
    );
    installedVersions[name] = metadata.version;
  }
  return {
    currentHead: await git('rev-parse', 'HEAD'),
    dependencyFingerprint: dependencyFiles
      .reduce((hash, file) => hash.update(file), createHash('sha256'))
      .digest('hex'),
    dependencyInputs,
    installedVersions,
    preparationMs: performance.now() - started,
    revisions,
    sources,
  };
};

export const buildProjects = async (runDirectory: string, sources: Record<string, string>) => {
  const times: Record<string, number> = {};
  process.env.NODE_ENV = 'production';
  for (const side of ['before', 'after']) {
    const root = path.join(runDirectory, side);
    await writeFile(
      path.join(root, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module" src="/entry.tsx"></script></body></html>',
    );
    await writeFile(
      path.join(root, 'entry.tsx'),
      `import { startExperiment } from ${JSON.stringify(path.join(import.meta.dirname, 'browser.tsx'))}; startExperiment();`,
    );
    const componentResolver: Plugin = {
      name: 'stylex-experiment-components',
      resolveId(id) {
        if (id.startsWith('experiment-component:'))
          return sources[`${side}:${id.slice('experiment-component:'.length)}`];
      },
    };
    const started = performance.now();
    await build({
      base: './',
      build: {
        chunkSizeWarningLimit: 10_000,
        cssMinify: false,
        minify: false,
        outDir: path.join(root, 'dist'),
        reportCompressedSize: false,
      },
      configFile: false,
      define: {
        '__CI__': 'false',
        '__DEV__': 'false',
        '__ELECTRON__': 'false',
        '__MOBILE__': 'false',
        '__REACT_SCAN__': 'false',
        '__TEST__': 'false',
        'process.env': '{}',
      },
      logLevel: 'error',
      plugins: [
        componentResolver,
        stylexPlugin({ overlaySrcDirs: [path.join(root, 'sources/src')] }),
        react(),
        ...lobeUiImports(),
        ...lobeIconImports(),
      ],
      publicDir: false,
      resolve: {
        alias: [
          { find: /^@\/const\//, replacement: path.join(repoRoot, 'packages/const/src/') },
          { find: '@', replacement: path.join(repoRoot, 'src') },
        ],
        dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/css', '@stylexjs/stylex'],
      },
      root,
    });
    times[side] = performance.now() - started;
  }
  return times;
};
