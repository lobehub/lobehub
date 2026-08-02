import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/utils/devAuth': resolve(__dirname, '../utils/src/devAuth.ts'),
      '@/': resolve(__dirname, '../../src') + '/',
    },
  },
  test: {
    environment: 'node',
  },
});
