import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { optionalPeerDepAssets } from './optionalPeerDepAssets';

const temporaryDirectories: string[] = [];

const writeFiles = async (root: string, files: Record<string, string>) => {
  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents);
    }),
  );
};

/**
 * A package shaped like `@lobehub/charts` 6.3: it dynamically imports a stylesheet of an
 * optional peer dependency the app does not install.
 */
const createFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vite-optional-peer-dep-assets-'));
  temporaryDirectories.push(root);

  await writeFiles(root, {
    'index.html': '<script type="module" src="/main.js"></script>',
    'main.js': "export { loadMap } from 'map-lib';",
    'node_modules/map-lib/index.js': [
      'export const loadMap = () =>',
      "  Promise.all([import('missing-peer'), import('missing-peer/dist/style.css').catch(() => undefined)]);",
    ].join('\n'),
    'node_modules/map-lib/package.json': JSON.stringify({
      main: 'index.js',
      name: 'map-lib',
      peerDependencies: { 'missing-peer': '*' },
      peerDependenciesMeta: { 'missing-peer': { optional: true } },
      type: 'module',
      version: '1.0.0',
    }),
    'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
  });

  return root;
};

/** Pre-bundles `map-lib`, then transforms its chunks the way the browser would request them. */
const transformPrebundledChunks = async (
  root: string,
  plugins: ReturnType<typeof optionalPeerDepAssets>[],
) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      include: ['map-lib'],
      noDiscovery: true,
      rolldownOptions: { plugins },
    },
    root,
    server: { middlewareMode: true, ws: false },
  });

  try {
    const optimizer = server.environments.client.depsOptimizer!;
    await optimizer.init();
    await optimizer.scanProcessing;
    const entry = await server.environments.client.pluginContainer.resolveId(
      'map-lib',
      path.join(root, 'main.js'),
    );

    const transformed: string[] = [];
    const queue = [entry!.id];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);

      const result = await server.transformRequest(url);
      transformed.push(result!.code);
      for (const [, imported] of result!.code.matchAll(/import\(["']([^"']+deps\/[^"']+)["']\)/g)) {
        queue.push(imported);
      }
    }
    return transformed.join('\n');
  } finally {
    await server.close();
  }
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('optionalPeerDepAssets', () => {
  it('reproduces Vite leaking the optional peer stylesheet as an unresolvable import', async () => {
    const root = await createFixture();

    await expect(transformPrebundledChunks(root, [])).rejects.toThrow(
      /Failed to resolve import "__vite-optional-peer-dep:missing-peer\/dist\/style\.css:map-lib"/,
    );
  });

  it('bundles the missing stylesheet as a module that throws, like a missing optional peer script', async () => {
    const root = await createFixture();

    const code = await transformPrebundledChunks(root, [optionalPeerDepAssets()]);

    expect(code).not.toMatch(/import\(["']__vite-optional-peer-dep:/);
    expect(code).toContain(
      String.raw`Could not resolve \"missing-peer/dist/style.css\" imported by \"map-lib\". Is it installed?`,
    );
  });

  it('leaves stylesheets that resolve untouched', async () => {
    const plugin = optionalPeerDepAssets();
    const resolveId = plugin.resolveId as { handler: (...args: unknown[]) => Promise<unknown> };
    const context = { resolve: async () => ({ id: '/repo/node_modules/pkg/style.css' }) };

    await expect(
      resolveId.handler.call(context, 'pkg/style.css', '/repo/node_modules/lib/index.js', {}),
    ).resolves.toBeNull();
    await expect(
      resolveId.handler.call(context, './style.css', '/repo/node_modules/lib/index.js', {}),
    ).resolves.toBeNull();
  });
});
