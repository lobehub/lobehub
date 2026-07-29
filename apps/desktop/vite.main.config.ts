import path from 'node:path';

import { defineConfig, type UserConfig } from 'vite';

import { externalRuntimeModules } from './external-runtime-deps.config.mjs';
import { getNativeExternalDependencies } from './native-deps.config.mjs';
import {
  applyDesktopViteConfigExtension,
  isCloudDesktopBuild,
  loadDesktopEnv,
  MAIN_NODE_TARGET,
  mainProcessAlias,
  nodeExternals,
  processEnvDefine,
} from './vite.shared';

export default defineConfig(async (env) => {
  const { mode } = env;
  loadDesktopEnv(mode);

  const isDev = mode === 'development';
  const updateChannel = process.env.UPDATE_CHANNEL;
  const isCloudDesktop = isCloudDesktopBuild();
  const externalNavigationHosts =
    process.env.DESKTOP_EXTERNAL_NAVIGATION_HOSTS ?? (isCloudDesktop ? 'stripe.com' : '');

  console.info(`[vite.main.config.ts] Detected UPDATE_CHANNEL: ${updateChannel}`);
  console.info(`[vite.main.config.ts] Cloud desktop build: ${isCloudDesktop}`);

  const config = {
    build: {
      assetsDir: 'chunks',
      copyPublicDir: false,
      emptyOutDir: true,
      lib: {
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        formats: ['cjs'],
      },
      minify: !isDev,
      modulePreload: false,
      outDir: 'dist/main',
      reportCompressedSize: false,
      rolldownOptions: {
        // Native modules must be externalized to work correctly.
        // bufferutil and utf-8-validate are optional peer deps of ws that may not be installed.
        external: [
          ...nodeExternals,
          ...externalRuntimeModules,
          'node-mac-permissions',
          ...getNativeExternalDependencies(),
          'bufferutil',
          'utf-8-validate',
        ],
        output: {
          assetFileNames: 'chunks/[name]-[hash].[ext]',
          // Prevent shared deps from being bundled into index.js to avoid side-effect pollution.
          // Pattern: when a module is imported by both the main bundle (statically) and a
          // dynamic-import chunk (lazy loader), rolldown places it in main and makes the
          // chunk back-reference `require("./index.js")`. Electron's main entry isn't in
          // Node's CJS cache, so that require recompiles `index.js` from scratch — which
          // re-runs `new App()` at top-level and triggers `protocol.registerSchemesAsPrivileged`
          // *after* the app is ready → throw.
          //
          // Same root cause as the original `debug` regression fixed in #11827. Isolate
          // each shared module into its own vendor chunk so both ends reference the vendor
          // chunk instead of back-referencing main.
          manualChunks(id: string) {
            if (id.includes('node_modules/debug')) {
              return 'vendor-debug';
            }

            // Small text/binary detection utilities in file-loaders/utils. Imported by
            // main (via `sniffBinaryFile`) and potentially by lazy loader chunks.
            // Explicitly enumerated to avoid catching `parser-utils.ts`, which pulls in
            // xmldom / yauzl / concat-stream — those belong in docx/pptx loader chunks.
            if (
              /packages\/file-loaders\/src\/utils\/(?:detectUtf16|isBinaryContent|isTextReadableFile)\.ts$/.test(
                id,
              )
            ) {
              return 'vendor-file-loaders-utils';
            }

            // jszip — imported by main (via some static path) AND by the docx loader chunk.
            // Without this, reading a .docx file throws the protocol re-init error.
            if (id.includes('node_modules/jszip')) {
              return 'vendor-jszip';
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
      ssr: true,
      ssrEmitAssets: true,
      target: MAIN_NODE_TARGET,
    },
    define: {
      ...processEnvDefine,
      'process.env.DESKTOP_EXTERNAL_NAVIGATION_HOSTS': JSON.stringify(externalNavigationHosts),
      'process.env.UPDATE_CHANNEL': JSON.stringify(process.env.UPDATE_CHANNEL),
      'process.env.UPDATE_SERVER_URL': JSON.stringify(process.env.UPDATE_SERVER_URL),
    },
    publicDir: false,
    resolve: {
      alias: mainProcessAlias,
      conditions: ['node'],
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    root: __dirname,
    ssr: { noExternal: true },
  } satisfies UserConfig;

  return applyDesktopViteConfigExtension('main', config, env);
});
