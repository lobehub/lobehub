import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // mirror the root tsconfig paths: package sources first, app src as fallback
      '@/const/': resolve(__dirname, '../const/src') + '/',
      '@/database/': resolve(__dirname, '../database/src') + '/',
      '@/envs/': resolve(__dirname, '../env/src') + '/',
      '@/': resolve(__dirname, '../../src') + '/',
    },
  },
  test: {
    environment: 'node',
  },
});
