import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@': resolve(__dirname, './src/main'),
      '~common': resolve(__dirname, './src/common'),
      '@lobechat/device-control': resolve(__dirname, '../../packages/device-control/src'),
      '@lobechat/device-control/workspace': resolve(
        __dirname,
        '../../packages/device-control/src/workspace',
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
