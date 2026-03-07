import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { defineConfig } from 'electron-vite';
import type { PluginOption, ViteDevServer } from 'vite';
import { loadEnv } from 'vite';

import {
  sharedOptimizeDeps,
  sharedRendererDefine,
  sharedRendererPlugins,
  sharedRollupOutput,
} from '../../plugins/vite/sharedRendererConfig';
import { getExternalDependencies } from './native-deps.config.mjs';

/**
 * Rewrite `/` to `/apps/desktop/index.html` so the electron-vite dev server
 * serves the desktop HTML entry when root is the monorepo root.
 */
function electronDesktopHtmlPlugin(): PluginOption {
  return {
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          req.url = '/apps/desktop/index.html';
        }
        next();
      });
    },
    name: 'electron-desktop-html',
  };
}

dotenv.config();

const isDev = process.env.NODE_ENV === 'development';
const ROOT_DIR = resolve(__dirname, '../..');
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

Object.assign(process.env, loadEnv(mode, ROOT_DIR, ''));
const updateChannel = process.env.UPDATE_CHANNEL;

console.info(`[electron-vite.config.ts] Detected UPDATE_CHANNEL: ${updateChannel}`);

export default defineConfig({
  main: {
    build: {
      minify: !isDev,
      outDir: 'dist/main',
      rollupOptions: {
        // Native modules must be externalized to work correctly
        external: getExternalDependencies(),
        output: {
          // Prevent debug package from being bundled into index.js to avoid side-effect pollution
          manualChunks(id) {
            if (id.includes('node_modules/debug')) {
              return 'vendor-debug';
            }

            // Split i18n json resources by namespace (ns), not by locale.
            // Example: ".../resources/locales/zh-CN/common.json?import" -> "locales-common"
            const normalizedId = id.replaceAll('\\', '/').split('?')[0];
            const match = normalizedId.match(/\/locales\/[^/]+\/([^/]+)\.json$/);

            if (match?.[1]) return `locales-${match[1]}`;
          },
        },
      },
      sourcemap: isDev ? 'inline' : false,
    },
    define: {
      'process.env.UPDATE_CHANNEL': JSON.stringify(process.env.UPDATE_CHANNEL),
      'process.env.UPDATE_SERVER_URL': JSON.stringify(process.env.UPDATE_SERVER_URL),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/main'),
        '~common': resolve(__dirname, 'src/common'),
      },
    },
  },
  preload: {
    build: {
      minify: !isDev,
      outDir: 'dist/preload',
      sourcemap: isDev ? 'inline' : false,
    },

    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/main'),
        '~common': resolve(__dirname, 'src/common'),
      },
    },
  },
  renderer: {
    root: ROOT_DIR,
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        output: sharedRollupOutput,
      },
    },
    define: sharedRendererDefine({ isMobile: false, isElectron: true }),
    optimizeDeps: sharedOptimizeDeps,
    plugins: [
      electronDesktopHtmlPlugin(),
      ...(sharedRendererPlugins({ platform: 'desktop' }) as PluginOption[]),
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
