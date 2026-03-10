import { resolve } from 'node:path';

import type { PluginOption, ViteDevServer } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { viteEnvRestartKeys } from './plugins/vite/envRestartKeys';
import {
  sharedOptimizeDeps,
  sharedRendererDefine,
  sharedRendererPlugins,
  sharedRollupOutput,
} from './plugins/vite/sharedRendererConfig';
import { vercelSkewProtection } from './plugins/vite/vercelSkewProtection';

const isMobile = process.env.MOBILE === 'true';
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

const isDev = process.env.NODE_ENV !== 'production';
const platform = isMobile ? 'mobile' : 'web';

export default defineConfig({
  base: isDev ? '/' : process.env.VITE_CDN_BASE || '/spa/',
  build: {
    outDir: isMobile ? 'dist/mobile' : 'dist/desktop',
    rollupOptions: {
      input: resolve(__dirname, isMobile ? 'index.mobile.html' : 'index.html'),
      output: sharedRollupOutput,
    },
  },
  define: sharedRendererDefine({ isMobile, isElectron: false }),
  optimizeDeps: sharedOptimizeDeps,
  plugins: [
    vercelSkewProtection(),
    viteEnvRestartKeys(['APP_URL']),
    ...sharedRendererPlugins({ platform }),

    isDev && {
      name: 'lobe-dev-proxy-print',
      configureServer(server: ViteDevServer) {
        const ONLINE_HOST = 'https://app.lobehub.com';
        const c = {
          green: (s: string) => `\x1B[32m${s}\x1B[0m`,
          bold: (s: string) => `\x1B[1m${s}\x1B[0m`,
          cyan: (s: string) => `\x1B[36m${s}\x1B[0m`,
        };
        const { info } = server.config.logger;
        return () => {
          server.printUrls = () => {
            const urls = server.resolvedUrls;
            if (!urls?.local?.[0]) return;
            const localHost = urls.local[0].replace(/\/$/, '');
            const proxyUrl = `${ONLINE_HOST}/_dangerous_local_dev_proxy?debug-host=${encodeURIComponent(localHost)}`;
            const colorUrl = (url: string) =>
              c.cyan(url.replace(/:(\d+)\//, (_, port) => `:${c.bold(port)}/`));
            info(`  ${c.green('➜')}  ${c.bold('Debug Proxy')}: ${colorUrl(proxyUrl)}`);
          };
        };
      },
    },

    VitePWA({
      injectRegister: null,
      manifest: false,
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
          },
          {
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 },
            },
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
          },
          {
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'image-assets',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 100 },
            },
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|avif)$/i,
          },
          {
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxAgeSeconds: 60 * 5, maxEntries: 50 },
            },
            urlPattern: /\/(api|trpc)\/.*/i,
          },
        ],
      },
    }),
  ].filter(Boolean) as PluginOption[],

  server: {
    cors: true,
    port: 9876,
    host: true,
    proxy: {
      '/api': 'http://localhost:3010',
      '/oidc': 'http://localhost:3010',
      '/trpc': 'http://localhost:3010',
      '/webapi': 'http://localhost:3010',
    },
    warmup: {
      clientFiles: [
        platform === 'mobile' ? './src/spa/entry.mobile.tsx' : './src/spa/entry.web.tsx',
      ],
    },
  },
});
