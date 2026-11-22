// @vitest-environment node
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { createServer, loadConfigFromFile, optimizeDeps, resolveConfig } from 'vite';
import { expect, it } from 'vitest';

it('resolves virtual lists from the dependency version owned by each importer', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const cacheDir = await mkdtemp(path.join(root, 'node_modules/.vite-virtual-list-test-'));
  const entry = path.join(cacheDir, 'entry.js');
  await writeFile(entry, "import { Virtualizer } from 'virtua'; console.log(Virtualizer);");
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    path.join(root, 'vite.config.ts'),
  );
  if (!loaded) throw new Error('Web Vite configuration could not be loaded');

  // A bare optimized id must not make UI's newer virtua resolve to the app's
  // older direct dependency. This occurs even with a fresh optimizer cache.
  const config = {
    cacheDir,
    configFile: false as const,
    logLevel: 'silent' as const,
    optimizeDeps: {
      ...loaded.config.optimizeDeps,
      entries: [entry],
      include: [],
      noDiscovery: false,
    },
    resolve: { dedupe: ['react', 'react-dom'] },
    root,
    server: { middlewareMode: true, watch: null },
  };
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    const resolvedConfig = await resolveConfig(config, 'serve');
    const { optimized } = await optimizeDeps(resolvedConfig, true);
    server = await createServer(config);
    const require = createRequire(path.join(root, 'package.json'));
    const uiImporter = await realpath(require.resolve('@lobehub/ui'));

    for (const importer of [uiImporter, path.join(root, 'src/features/Settings/index.tsx')]) {
      const expected = await realpath(createRequire(importer).resolve('virtua'));
      const resolved = await server.environments.client.pluginContainer.resolveId(
        'virtua',
        importer,
      );
      const id = resolved?.id.split('?')[0];
      const source = Object.values(optimized).find((entry) => entry.file === id)?.src ?? id;
      expect(source).toBeDefined();
      expect(path.dirname(source!)).toBe(path.dirname(expected));
    }
  } finally {
    await server?.close();
    await rm(cacheDir, { force: true, recursive: true });
  }
});
