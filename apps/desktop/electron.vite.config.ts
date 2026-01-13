import dotenv from 'dotenv';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

import { getExternalDependencies } from './native-deps.config.mjs';

dotenv.config();

const isDev = process.env.NODE_ENV === 'development';
const updateChannel = process.env.UPDATE_CHANNEL;
console.log(`[electron-vite.config.ts] Detected UPDATE_CHANNEL: ${updateChannel}`); // 添加日志确认

export default defineConfig({
  main: {
    build: {
      minify: !isDev,
      outDir: 'dist/main',
      rollupOptions: {
        // Native modules must be externalized to work correctly
        external: getExternalDependencies(),
      },
      sourcemap: isDev ? 'inline' : false,
    },
    // 这里是关键：在构建时进行文本替换
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.OFFICIAL_CLOUD_SERVER': JSON.stringify(process.env.OFFICIAL_CLOUD_SERVER),
      'process.env.UPDATE_CHANNEL': JSON.stringify(process.env.UPDATE_CHANNEL),
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
});
