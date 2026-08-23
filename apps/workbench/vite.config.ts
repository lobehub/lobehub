import path from 'node:path';

import type { PluginOption } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { viteEnvRestartKeys } from '../../plugins/vite/envRestartKeys';
import {
  createSharedRolldownOutput,
  sharedModulePreload,
  sharedOptimizeDeps,
  sharedRendererDedupe,
  sharedRendererDefine,
  sharedRendererPlugins,
} from '../../plugins/vite/sharedRendererConfig';
import { vercelSkewProtection } from '../../plugins/vite/vercelSkewProtection';
import { createViteWatchOptions } from '../../plugins/vite/watchOptions';

const repoRoot = path.resolve(__dirname, '../..');
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

Object.assign(process.env, loadEnv(mode, repoRoot, ''));

const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  base: isDev ? '/' : process.env.VITE_CDN_BASE || '/_spa-workbench/',
  build: {
    emptyOutDir: true,
    modulePreload: sharedModulePreload,
    outDir: path.resolve(repoRoot, 'dist/workbench'),
    reportCompressedSize: false,
    rolldownOptions: {
      output: createSharedRolldownOutput({ strictExecutionOrder: true }),
    },
  },
  define: {
    ...sharedRendererDefine({ isElectron: false, isMobile: true }),
  },
  experimental: {
    bundledDev: false,
  },
  optimizeDeps: sharedOptimizeDeps,
  plugins: [
    tsconfigPaths({
      ignoreConfigErrors: true,
      projects: [path.resolve(repoRoot, 'tsconfig.json')],
      root: repoRoot,
    }),
    vercelSkewProtection(),
    viteEnvRestartKeys(['APP_URL']),
    ...sharedRendererPlugins({ platform: 'mobile' }),
  ].filter(Boolean) as PluginOption[],
  resolve: {
    dedupe: sharedRendererDedupe,
  },
  root: __dirname,
  server: {
    cors: true,
    fs: {
      allow: [repoRoot],
    },
    host: true,
    port: Number(process.env.WORKBENCH_SPA_PORT) || 3014,
    proxy: {
      '/api': `http://localhost:${process.env.PORT || 3010}`,
      '/oidc': `http://localhost:${process.env.PORT || 3010}`,
      '/trpc': `http://localhost:${process.env.PORT || 3010}`,
      '/webapi': `http://localhost:${process.env.PORT || 3010}`,
    },
    strictPort: true,
    watch: createViteWatchOptions([repoRoot]),
  },
});
