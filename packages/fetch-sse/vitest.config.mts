import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      // Keep this package unit-testable when a parent workspace overrides model-runtime.
      '@lobechat/model-runtime': path.resolve(__dirname, '../model-runtime/src/helpers/index.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
  },
});
