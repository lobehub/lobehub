import path from 'node:path';

import { defineConfig } from 'vitest/config';

const { resolve } = path;

export default defineConfig({
  test: {
    alias: {
      '@': resolve(__dirname, './src/main'),
      '~common': resolve(__dirname, './src/common'),
      '@lobechat/device-control/project-file-index': resolve(
        __dirname,
        '../../packages/device-control/src/projectFileIndex',
      ),
      '@lobechat/device-control/skill-directory': resolve(
        __dirname,
        '../../packages/device-control/src/skillDirectory',
      ),
      '@lobechat/device-control/workspace': resolve(
        __dirname,
        '../../packages/device-control/src/workspace',
      ),
      '@lobechat/device-control': resolve(__dirname, '../../packages/device-control/src'),
      '@lobechat/local-file-shell/content-search': resolve(
        __dirname,
        '../../packages/local-file-shell/src/contentSearch',
      ),
      '@lobechat/local-file-shell/file-search': resolve(
        __dirname,
        '../../packages/local-file-shell/src/fileSearch',
      ),
      '@lobechat/local-file-shell/file': resolve(
        __dirname,
        '../../packages/local-file-shell/src/file',
      ),
      '@lobechat/local-file-shell/git': resolve(
        __dirname,
        '../../packages/local-file-shell/src/git',
      ),
      '@lobechat/local-file-shell/logger': resolve(
        __dirname,
        '../../packages/local-file-shell/src/logger',
      ),
      '@lobechat/local-file-shell/shell': resolve(
        __dirname,
        '../../packages/local-file-shell/src/shell',
      ),
      '@lobechat/local-file-shell/types': resolve(
        __dirname,
        '../../packages/local-file-shell/src/types',
      ),
      // Not hoisted to the (super)project root node_modules, so resolve it to
      // workspace source like the packages above.
      '@lobechat/device-identity': resolve(__dirname, '../../packages/device-identity/src'),
      '@lobechat/local-file-shell': resolve(__dirname, '../../packages/local-file-shell/src'),
    },
    coverage: {
      all: false,
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
      reportsDirectory: './coverage/app',
    },
    environment: 'node',
    setupFiles: ['./src/main/__mocks__/setup.ts'],
  },
});
