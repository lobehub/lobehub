import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: [
      {
        // Keep the root import unit-testable without shadowing package subpath exports.
        find: /^@lobechat\/model-runtime$/,
        replacement: path.resolve(__dirname, '../model-runtime/src/helpers/index.ts'),
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
  },
});
