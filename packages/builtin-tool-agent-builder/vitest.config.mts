import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
