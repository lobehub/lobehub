import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { prepareServerI18n, watchServerI18n } from '../../scripts/serverI18n/prepare';

const SERVER_CONFIG_DIR = path.dirname(new URL(import.meta.url).pathname);
const cloudRootTsconfig = path.resolve(SERVER_CONFIG_DIR, '../../../tsconfig.json');
const lobehubRootTsconfig = path.resolve(SERVER_CONFIG_DIR, '../../tsconfig.json');
const tsconfigProjects = [
  existsSync(cloudRootTsconfig) ? cloudRootTsconfig : null,
  lobehubRootTsconfig,
].filter((value): value is string => value !== null);

const rawMdPlugin: Plugin = {
  name: 'lobe-vite-node-raw-md',
  load(id) {
    const [filepath] = id.split('?');
    if (!filepath.endsWith('.md')) return;

    return `export default ${JSON.stringify(readFileSync(filepath, 'utf8'))};`;
  },
};

export const honoServerPlugins = () => [
  {
    name: 'server-i18n',
    async buildStart() {
      await prepareServerI18n(path.dirname(tsconfigProjects[0]));
    },
    async configureServer(server) {
      const stop = await watchServerI18n(path.dirname(tsconfigProjects[0]));
      server.httpServer?.once('close', stop);
    },
  } satisfies Plugin,
  rawMdPlugin,
  tsconfigPaths({ loose: true, projects: tsconfigProjects }),
];

export const honoServerDedupe = ['@lobehub/editor'];

export default defineConfig({
  plugins: honoServerPlugins(),
  resolve: {
    dedupe: honoServerDedupe,
  },
});
