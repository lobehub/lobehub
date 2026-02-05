import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@': resolve(__dirname, '../../src'),
    },
    coverage: {
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
