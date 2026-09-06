import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // mirror the root tsconfig paths: package sources first, app src as fallback
      '@/const/': path.resolve(__dirname, '../const/src') + '/',
      '@/database/': path.resolve(__dirname, '../database/src') + '/',
      '@/envs/': path.resolve(__dirname, '../env/src') + '/',
      '@/server/': path.resolve(__dirname, '../../apps/server/src') + '/',
      '@/utils/rbac': path.resolve(__dirname, '../../src/utils/rbac.ts'),
      '@/utils/': path.resolve(__dirname, '../utils/src') + '/',
      '@/': path.resolve(__dirname, '../../src') + '/',
    },
  },
  test: {
    environment: 'node',
  },
});
