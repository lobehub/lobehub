import path from 'node:path';

import { defineConfig, type UserConfig } from 'vite';
import zodCompiler from 'zod-compiler/vite';

import { viteOsPlatformResolve } from '../../plugins/vite/osPlatformResolve';
import { externalRuntimeModules } from './external-runtime-deps.config.mjs';
import { getNativeExternalDependencies } from './native-deps.config.mjs';
import { rendererMainHashArtifact, resolveMainHash } from './scripts/mainHash.mjs';
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
  const mainHash = resolveMainHash();
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
          // Keep Electron's side-effectful entry as a tiny bootstrap and put the
          // application graph in a normal CommonJS chunk. Electron evaluates its entry
          // outside the usual CJS cache path; when a deferred chunk back-references
          // `index.js`, the entry can otherwise run again after app.ready. A regular
          // `main-app` chunk is cached by Node, so lazy features can safely reuse any
          // module from the eager graph without re-running `new App()`.
          //
          // This is intentionally one architectural boundary rather than a growing list
          // of shared vendor packages. Forcing Ajv, semver, env schemas, and similar
          // dependencies into manual chunks de-optimizes tree-shaking and increases the
          // amount of JavaScript parsed before renderer navigation.
          manualChunks(id: string) {
            const normalizedId = id.replaceAll('\\', '/').split('?')[0];

            if (/apps\/desktop\/src\/main\/core\/App\.ts$/.test(normalizedId)) {
              return 'main-app';
            }

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
      'process.env.MAIN_HASH': JSON.stringify(mainHash),
      'process.env.RENDERER_OTA_PUBLIC_KEY': JSON.stringify(process.env.RENDERER_OTA_PUBLIC_KEY),
      'process.env.UPDATE_CHANNEL': JSON.stringify(process.env.UPDATE_CHANNEL),
      'process.env.UPDATE_SERVER_URL': JSON.stringify(process.env.UPDATE_SERVER_URL),
    },
    plugins: [viteOsPlatformResolve(), zodCompiler(), rendererMainHashArtifact(mainHash)],
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
