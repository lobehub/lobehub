import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // mirror the root tsconfig paths: package sources first, app src as fallback
      '@/const/': path.resolve(__dirname, '../const/src') + '/',
      '@/database/': path.resolve(__dirname, '../database/src') + '/',
      '@/envs/': path.resolve(__dirname, '../env/src') + '/',
      '@/utils/devAuth': path.resolve(__dirname, '../utils/src/devAuth.ts'),
      '@/': path.resolve(__dirname, '../../src') + '/',
    },
  },
  test: {
    environment: 'node',
  },
});
