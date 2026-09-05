import { describe, expect, it } from 'vitest';

import { collectFirstScreen, firstScreenForbidden, homeRouteForbidden } from './firstScreenGate';

const chunk = (
  name: string,
  modules: Record<string, number>,
  extra: Partial<{ imports: string[]; isEntry: boolean }> = {},
) => ({
  code: Object.keys(modules).join('\n'),
  fileName: `${name}.js`,
  imports: extra.imports ?? [],
  isEntry: extra.isEntry ?? false,
  moduleIds: Object.keys(modules),
  modules: Object.fromEntries(
    Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }]),
  ),
  name,
  type: 'chunk' as const,
});

const graph: Record<string, string[]> = {
  '/src/entry.tsx': ['/src/shell.ts'],
  '/src/shell.ts': ['/node_modules/react/index.js'],
  '/node_modules/react/index.js': [],
  '/node_modules/posthog-js/dist/module.js': [],
  '/src/lazy.ts': [],
};
const getModuleInfo = (id: string) =>
  id in graph ? { importedIds: graph[id], isEntry: id === '/src/entry.tsx' } : null;

describe('collectFirstScreen', () => {
  it('walks the entry chunk closure and reports bytes without a static path from the entry', () => {
    const bundle = {
      'index.js': chunk(
        'index',
        { '/src/entry.tsx': 10, '/src/shell.ts': 10 },
        {
          imports: ['vendor.js'],
          isEntry: true,
        },
      ),
      'lazy.js': chunk('lazy', { '/src/lazy.ts': 5000 }),
      'vendor.js': chunk('vendor', {
        '/node_modules/posthog-js/dist/module.js': 4096,
        '/node_modules/react/index.js': 10,
      }),
    };

    const report = collectFirstScreen(bundle, getModuleInfo, {
      forbidden: firstScreenForbidden,
      maxGzipKB: 1,
      maxUnreachableKB: 1,
    });

    expect(report.eagerChunks.sort()).toEqual(['index.js', 'vendor.js']);
    expect(report.unreachableKB).toBe(4);
    expect(report.violations).toEqual([
      '4KB emitted into eager chunks without a static path from the entry (budget 1KB)',
      'posthog reached the first screen: /node_modules/posthog-js/dist/module.js',
    ]);
  });

  it('budgets a route closure and applies its own forbidden list', () => {
    const bundle = {
      'home.js': chunk('home', { '/src/routes/(main)/home/index.tsx': 10 }, { imports: ['md.js'] }),
      'index.js': chunk('index', { '/src/entry.tsx': 10, '/src/shell.ts': 10 }, { isEntry: true }),
      'md.js': chunk('md', { '/node_modules/katex/dist/katex.mjs': 4096 }),
    };

    const report = collectFirstScreen(bundle, getModuleInfo, {
      forbidden: firstScreenForbidden,
      maxGzipKB: 1,
      routes: [
        {
          forbidden: homeRouteForbidden,
          maxGzipKB: 1,
          name: 'home',
          roots: ['src/routes/(main)/home/index.tsx'],
        },
      ],
    });

    expect(report.routes).toEqual([{ chunks: 2, gzipKB: 0, name: 'home' }]);
    expect(report.violations).toEqual([
      'markdown stack reached route "home": /node_modules/katex/dist/katex.mjs',
    ]);
  });

  it('stays quiet inside budget', () => {
    const bundle = {
      'index.js': chunk('index', { '/src/entry.tsx': 10, '/src/shell.ts': 10 }, { isEntry: true }),
    };

    const report = collectFirstScreen(bundle, getModuleInfo, {
      forbidden: firstScreenForbidden,
      maxGzipKB: 1,
    });

    expect(report.violations).toEqual([]);
  });
});
