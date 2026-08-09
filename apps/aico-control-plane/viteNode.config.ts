import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CONFIG_DIR, '../..');
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

export const controlPlaneDedupe = ['@lobehub/editor'];

export default defineConfig({
  plugins: controlPlanePlugins(),
  resolve: {
    alias: [
      { find: '@/server', replacement: path.join(REPO_ROOT, 'apps/server/src') },
      { find: '@/envs', replacement: path.join(REPO_ROOT, 'packages/env/src') },
      { find: '@/libs/trpc', replacement: path.join(REPO_ROOT, 'packages/trpc/src') },
      { find: '@/database', replacement: path.join(REPO_ROOT, 'packages/database/src') },
      { find: '@/auth', replacement: path.join(REPO_ROOT, 'src/auth') },
      {
        find: '@/business/server',
        replacement: path.join(REPO_ROOT, 'packages/business-server/src'),
      },
      { find: '@/const', replacement: path.join(REPO_ROOT, 'packages/const/src') },
      { find: '@/utils', replacement: path.join(REPO_ROOT, 'packages/utils/src') },
      { find: '@/types', replacement: path.join(REPO_ROOT, 'packages/types/src') },
      { find: '@/config', replacement: path.join(REPO_ROOT, 'packages/app-config/src') },
      { find: '@/locales', replacement: path.join(REPO_ROOT, 'packages/locales/src') },
      { find: '@', replacement: path.join(REPO_ROOT, 'src') },
    ],
    dedupe: controlPlaneDedupe,
  },
});
