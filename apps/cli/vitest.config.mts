import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@lobechat/device-gateway-client',
        replacement: path.resolve(__dirname, '../../packages/device-gateway-client/src/index.ts'),
      },
      {
        find: '@lobechat/local-file-shell',
        replacement: path.resolve(__dirname, '../../packages/local-file-shell/src/index.ts'),
      },
      {
        find: '@lobechat/file-loaders',
        replacement: path.resolve(__dirname, '../../packages/file-loaders/src/index.ts'),
      },
    ],
  },
  test: {
    coverage: {
      all: false,
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
    // Suppress unhandled rejection warnings from Commander async actions with mocked process.exit
    onConsoleLog: () => true,
  },
});
