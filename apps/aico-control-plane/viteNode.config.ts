import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const CONFIG_DIR = path.dirname(new URL(import.meta.url).pathname);
const cloudRootTsconfig = path.resolve(CONFIG_DIR, '../../../tsconfig.json');
const lobehubRootTsconfig = path.resolve(CONFIG_DIR, '../../tsconfig.json');
const tsconfigProjects = [
  existsSync(cloudRootTsconfig) ? cloudRootTsconfig : null,
  lobehubRootTsconfig,
].filter((value): value is string => value !== null);

const rawMdPlugin: Plugin = {
  name: 'aico-control-plane-raw-md',
  load(id) {
    const [filepath] = id.split('?');
    if (!filepath.endsWith('.md')) return;

    return `export default ${JSON.stringify(readFileSync(filepath, 'utf8'))};`;
  },
};

export const controlPlanePlugins = () => [
  rawMdPlugin,
  tsconfigPaths({ loose: true, projects: tsconfigProjects }),
];

export default defineConfig({
  plugins: controlPlanePlugins(),
  resolve: {
    dedupe: ['@lobehub/editor'],
  },
});
