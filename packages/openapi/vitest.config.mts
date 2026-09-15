import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // mirror the root tsconfig paths: package sources first, app src as fallback
      '@/business/server': resolve(__dirname, '../business-server/src'),
      '@/const': resolve(__dirname, '../const/src'),
      '@/config': resolve(__dirname, '../app-config/src'),
      '@/database': resolve(__dirname, '../database/src'),
      '@/envs': resolve(__dirname, '../env/src'),
      '@/libs/trpc': resolve(__dirname, '../trpc/src'),
      '@/locales': resolve(__dirname, '../locales/src'),
      '@/server': resolve(__dirname, '../../apps/server/src'),
      '@/types': resolve(__dirname, '../types/src'),
      // packages/utils has no rbac module; the app-level helper is the real source
      '@/utils/rbac': resolve(__dirname, '../../src/utils/rbac'),
      '@/utils': resolve(__dirname, '../utils/src'),
      '@': resolve(__dirname, '../../src'),
    },
  },
  test: {
    environment: 'node',
  },
});
