import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { DevTools } from '@vitejs/devtools';
import type { PluginOption, ViteDevServer } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { canvasRuntimeEntries } from './plugins/vite/canvasRuntime';
import { customBrandingLoadingScreen } from './plugins/vite/customBrandingLoadingScreen';
import { viteEnvRestartKeys } from './plugins/vite/envRestartKeys';
import { lobeUiImportSources } from './plugins/vite/lobeUiImports';
import {
  createSharedRolldownOutput,
  sharedModulePreload,
  sharedOptimizeDeps,
  sharedPwaGlobIgnores,
  sharedPwaRuntimeCaching,
  sharedRendererDedupe,
  sharedRendererDefine,
  sharedRendererPlugins,
} from './plugins/vite/sharedRendererConfig';
import { vercelSkewProtection } from './plugins/vite/vercelSkewProtection';
import { createViteWatchOptions } from './plugins/vite/watchOptions';

const isMobile = process.env.MOBILE === 'true';
const isAuth = process.env.AUTH === 'true';
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

const isDev = process.env.NODE_ENV !== 'production';
const platform = isAuth ? 'auth' : isMobile ? 'mobile' : 'web';
const enableViteDevTools = process.env.LOBE_VITE_DEVTOOLS === 'true';

const resolveCommandExecutable = (cmd: string) => {
  const pathValue = process.env.PATH;
  if (!pathValue) return;

  if (process.platform === 'win32') {
    const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(Boolean)
      .map((ext) => ext.toLowerCase());
    const candidateNames = cmd.includes('.') ? [cmd] : pathExt.map((ext) => `${cmd}${ext}`);

    for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
      for (const candidate of candidateNames) {
        const resolved = path.win32.join(entry, candidate);
        if (fs.existsSync(resolved)) return resolved;
      }
    }

    return;
  }

  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    const resolved = path.join(entry, cmd);
    if (fs.existsSync(resolved)) return resolved;
  }
};

const openExternalBrowser = async (
  url: string,
  logger?: { warn: (msg: string) => void },
): Promise<boolean> => {
  const command =
    process.platform === 'win32'
      ? {
          args: ['url.dll,FileProtocolHandler', url],
          cmd: 'rundll32',
        }
      : {
          args: [url],
          cmd: process.platform === 'darwin' ? 'open' : 'xdg-open',
        };

  const executable = resolveCommandExecutable(command.cmd);
  if (!executable) {
    logger?.warn(`openExternalBrowser: ${command.cmd} not found on PATH`);
    return false;
  }

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(executable, command.args, {
        detached: true,
        stdio: 'ignore',
      });
      let settled = false;
      const done = (ok: boolean, reason?: string) => {
        if (settled) return;
        settled = true;
        if (!ok && reason) logger?.warn(`openExternalBrowser: ${reason}`);
        resolve(ok);
      };
      child.once('error', (err) => done(false, (err as Error).message));
      child.once('spawn', () => {
        child.unref();
        done(true);
      });
      setTimeout(() => done(true), 200);
    } catch (e) {
      logger?.warn(`openExternalBrowser: ${(e as Error).message}`);
      resolve(false);
    }
  });
};

export default defineConfig({
  base: isDev ? '/' : process.env.VITE_CDN_BASE || (isAuth ? '/_spa-auth/' : '/_spa/'),
  build: {
    modulePreload: sharedModulePreload,
    outDir: isAuth ? 'dist/auth' : isMobile ? 'dist/mobile' : 'dist/desktop',
    reportCompressedSize: false,
    rolldownOptions: {
      ...(enableViteDevTools && { devtools: {} }),
      input: path.resolve(
        __dirname,
        isAuth ? 'index.auth.html' : isMobile ? 'index.mobile.html' : 'index.html',
      ),
      output: createSharedRolldownOutput({
        initialEntries: {
          main: path.resolve(
            __dirname,
            isAuth ? 'index.auth.html' : isMobile ? 'index.mobile.html' : 'index.html',
          ),
          // Mobile/auth have no Canvas consumer, so the plugin emits no runtime entries.
          ...(!isAuth && !isMobile && canvasRuntimeEntries),
        },
        strictExecutionOrder: true,
      }),
      preserveEntrySignatures: 'allow-extension',
    },
  },
  define: {
    ...sharedRendererDefine({ isMobile, isElectron: false }),
  },
  experimental: {
    bundledDev: false,
  },
  resolve: {
    dedupe: sharedRendererDedupe,
    tsconfigPaths: true,
  },
  optimizeDeps: {
    ...sharedOptimizeDeps,
    // Web rewrites UI imports to individual modules. Forcing its root barrel
    // into the optimizer would still pre-bundle every deferred UI dependency.
    include: [
      ...sharedOptimizeDeps.include.filter((dependency) => dependency !== '@lobehub/ui'),
      // Excluded ESM UI modules still need their nested CommonJS shims optimized.
      '@lobehub/ui > use-sync-external-store/shim',
      '@lobehub/ui > use-sync-external-store/shim/with-selector',
      '@lobehub/ui > lru_map',
      '@lobehub/ui > style-to-js',
      '@lobehub/ui > @primer/octicons',
      '@lobehub/ui > extend',
      '@lobehub/ui > dayjs/plugin/advancedFormat.js',
      '@lobehub/ui > dayjs/plugin/customParseFormat.js',
      '@lobehub/ui > dayjs/plugin/localeData.js',
      '@lobehub/ui > dayjs/plugin/weekday.js',
      '@lobehub/ui > dayjs/plugin/weekOfYear.js',
      '@lobehub/ui > dayjs/plugin/weekYear.js',
    ],
    exclude: [...sharedOptimizeDeps.exclude, ...lobeUiImportSources, '@lobehub/icons'],
  },
  plugins: [
    isMobile &&
      isDev && {
        name: 'mobile-runtime-html-dev-entry',
        enforce: 'pre' as const,
        configureServer(server: ViteDevServer) {
          server.middlewares.use((req, _res, next) => {
            const raw = req.url;
            if (!raw) return next();
            const q = raw.indexOf('?');
            const pathOnly = q === -1 ? raw : raw.slice(0, q);
            const search = q === -1 ? '' : raw.slice(q);
            if (pathOnly === '/' || pathOnly === '/index.html') {
              req.url = `/index.mobile.html${search}`;
            }
            next();
          });
        },
      },
    vercelSkewProtection(),
    customBrandingLoadingScreen(),
    viteEnvRestartKeys(['APP_URL']),
    enableViteDevTools &&
      DevTools({
        build: {
          withApp: true,
        },
      }),
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
        const isBundledDev = (server.config.experimental as any)?.bundledDev;

        const getProxyUrl = () => {
          const urls = server.resolvedUrls;
          if (!urls?.local?.[0]) return;
          const localHost = urls.local[0].replace(/\/$/, '');
          return `${ONLINE_HOST}/_dangerous_local_dev_proxy?debug-host=${encodeURIComponent(localHost)}`;
        };
        const printProxyUrl = () => {
          const proxyUrl = getProxyUrl();
          if (!proxyUrl) return;
          const colorUrl = (url: string) =>
            c.cyan(url.replace(/:(\d+)\//, (_, port) => `:${c.bold(port)}/`));
          info(`  ${c.green('➜')}  ${c.bold('Debug Proxy')}: ${colorUrl(proxyUrl)}`);
        };
        const openProxyUrl = async () => {
          const proxyUrl = getProxyUrl();
          if (!proxyUrl) return;

          const opened = await openExternalBrowser(proxyUrl, server.config.logger);

          if (!opened) {
            server.config.logger.warn(`Failed to open Debug Proxy automatically: ${proxyUrl}`);
          }
        };

        if (isBundledDev) {
          // Disable Vite's built-in browser opening. We always open the debug
          // proxy URL after the first bundled compile finishes instead.
          server.openBrowser = () => {};

          const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
          let spinnerIdx = 0;
          let spinnerTimer: NodeJS.Timeout | null = null;
          const formatElapsed = (ms: number) =>
            ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;

          const startSpinner = (msg: string, since: number) => {
            spinnerIdx = 0;
            spinnerTimer = setInterval(() => {
              const elapsed = formatElapsed(Date.now() - since);
              process.stdout.write(`\r${c.cyan(spinnerFrames[spinnerIdx])} ${msg} (${elapsed})`);
              spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;
            }, 80);
          };
          const stopSpinner = (clearLine = true) => {
            if (spinnerTimer) {
              clearInterval(spinnerTimer);
              spinnerTimer = null;
            }
            if (clearLine) process.stdout.write('\r\x1B[K');
          };

          server.httpServer?.once('listening', () => {
            void (async () => {
              const rootUrl =
                server.resolvedUrls?.local?.[0] ||
                `http://localhost:${String(server.config.server.port || 9876)}/`;
              const startedAt = Date.now();
              const timeout = 180_000;
              const interval = 400;
              let ready = false;

              startSpinner('Vite: compile and bundle...', startedAt);

              try {
                while (Date.now() - startedAt < timeout) {
                  try {
                    const res = await fetch(rootUrl, { signal: AbortSignal.timeout(5_000) });
                    const text = await res.text();
                    if (text.includes('Bundling in progress')) {
                      await new Promise((r) => setTimeout(r, interval));
                      continue;
                    }
                    ready = true;
                    stopSpinner();
                    info(
                      `  ${c.green('✅')}  Vite: compile and bundle finished (${res.status}) ${rootUrl}`,
                    );
                    void openProxyUrl();
                    break;
                  } catch {
                    await new Promise((r) => setTimeout(r, interval));
                  }
                }
              } catch (e) {
                stopSpinner();
                console.warn('⚠️ Vite: could not wait for compile and bundle:', e);
              }

              if (!ready && spinnerTimer) {
                stopSpinner();
                console.warn(`⚠️ Vite: compile and bundle timed out after ${timeout / 1000}s`);
              }

              printProxyUrl();
            })();
          });
        }

        return () => {
          server.printUrls = () => {
            if (isBundledDev) return;
            printProxyUrl();
          };
        };
      },
    },

    !isAuth &&
      VitePWA({
        injectRegister: null,
        manifest: false,
        registerType: 'prompt',
        workbox: {
          globIgnores: sharedPwaGlobIgnores,
          globPatterns: ['**/*.{js,css,html,woff2}'],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          runtimeCaching: [
            ...sharedPwaRuntimeCaching,
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
    host: true,
    port: isMobile
      ? Number(process.env.MOBILE_SPA_PORT) || 3012
      : isAuth
        ? Number(process.env.AUTH_SPA_PORT) || 3013
        : Number(process.env.SPA_PORT) || 9876,
    // The dev orchestrator (scripts/devStartupSequence.mts) pre-resolves a free
    // port and injects it via env; never silently drift to another port, since
    // downstream consumers locate this server through that env contract.
    strictPort: true,
    // Transform imports when requested, rather than racing ahead through the
    // chat shell's large dependency graph while the optimizer is still running.
    preTransformRequests: false,
    proxy: {
      '/api': `http://localhost:${process.env.PORT || 3010}`,
      '/oidc': `http://localhost:${process.env.PORT || 3010}`,
      '/trpc': `http://localhost:${process.env.PORT || 3010}`,
      '/webapi': `http://localhost:${process.env.PORT || 3010}`,
    },
    warmup: {
      // Pre-transform entry modules; Vite follows their static imports on demand.
      // Whole-tree globs also compile lazy routes, tests and server-only packages.
      clientFiles: [
        './src/spa/entry.auth.tsx',
        ...(isAuth ? [] : [isMobile ? './src/spa/entry.mobile.tsx' : './src/spa/entry.web.tsx']),
      ],
    },
    watch: createViteWatchOptions([__dirname]),
  },
});
