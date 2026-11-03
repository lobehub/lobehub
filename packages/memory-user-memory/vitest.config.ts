import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'raw-md',
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
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
