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
      '@/const': resolve(__dirname, '../const/src'),
      '@/utils/errorResponse': resolve(__dirname, '../../src/utils/errorResponse'),
      '@/utils': resolve(__dirname, '../utils/src'),
      '@/database': resolve(__dirname, '../database/src'),
      '@/libs/model-runtime': resolve(__dirname, '../model-runtime/src'),
      '@/types': resolve(__dirname, '../types/src'),
      '@/config': resolve(__dirname, '../app-config/src'),
      '@/envs': resolve(__dirname, '../env/src'),
      '@/libs/trpc': resolve(__dirname, '../trpc/src'),
      '@/locales': resolve(__dirname, '../locales/src'),
      '@/business/server': resolve(__dirname, '../business-server/src'),
      '@/server/services': resolve(__dirname, '../../apps/server/src/services'),
      '@/server/modules': resolve(__dirname, '../../apps/server/src/modules'),
      '@': resolve(__dirname, '../../src'),
    },
    coverage: {
      exclude: [
        // https://github.com/lobehub/lobe-chat/pull/7265
        // Vitest 4+ ships an empty `coverageConfigDefaults.exclude`; keep the previous
        // default exclusions explicitly so the coverage set does not silently grow.
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
        'src/server/core/dbForTest.ts',
      ],
      include: ['src/models/**/*.ts', 'src/server/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    env: {
      TEST_SERVER_DB: '1',
    },
    environment: 'node',
    isolate: false,
    maxWorkers: 1,
    setupFiles: './tests/setup-db.ts',
  },
});
