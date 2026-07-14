import path from 'node:path';

import { defineConfig } from 'vite';

import {
  loadDesktopEnv,
  MAIN_NODE_TARGET,
  mainProcessAlias,
  nodeExternals,
  processEnvDefine,
} from './vite.shared';

export default defineConfig(({ mode }) => {
  loadDesktopEnv(mode);

  const isDev = mode === 'development';

  return {
    build: {
      assetsDir: 'chunks',
      copyPublicDir: false,
      emptyOutDir: true,
      lib: {
        entry: path.resolve(__dirname, 'src/preload/index.ts'),
        formats: ['cjs'],
      },
      minify: !isDev,
      modulePreload: false,
      outDir: 'dist/preload',
      reportCompressedSize: false,
      rolldownOptions: {
        external: nodeExternals,
      },
      sourcemap: isDev ? 'inline' : false,
      ssr: true,
      ssrEmitAssets: true,
      target: MAIN_NODE_TARGET,
    },
    define: { ...processEnvDefine },
    publicDir: false,
    resolve: {
      alias: mainProcessAlias,
    },
    root: __dirname,
    ssr: {
      noExternal: true,
      resolve: {
        conditions: ['module', 'browser', 'development|production'],
        mainFields: ['browser', 'module', 'jsnext:main', 'jsnext'],
      },
    },
  };
});
