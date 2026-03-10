import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@lobechat/device-gateway-client',
        replacement: path.resolve(__dirname, '../../packages/device-gateway-client/src/index.ts'),
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
