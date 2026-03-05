import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: {
    exclude: ['crypto', 'util', 'tty'],
    include: ['@lobehub/tts'],
  },
  test: {
    alias: {
      '@/const': resolve(__dirname, '../const/src'),
      '@/utils/errorResponse': resolve(__dirname, '../../src/utils/errorResponse'),
      '@/utils': resolve(__dirname, '../utils/src'),
      '@/database': resolve(__dirname, '../database/src'),
      '@/libs/model-runtime': resolve(__dirname, '../model-runtime/src'),
      '@/types': resolve(__dirname, '../types/src'),
      '@': resolve(__dirname, '../../src'),

    },
    coverage: {
      exclude: [
        'src/server/**',
        'src/repositories/dataImporter/deprecated/**',
        'src/types/**',
        'src/models/userMemory/sources/index.ts',
        'src/models/userMemory/sources/shared.ts',
        'src/models/ragEval/index.ts',
        'src/models/agentEval/index.ts',
        'src/repositories/userMemory/index.ts',
        'src/models/_template.ts',
        'src/models/__tests__/_test_template.ts',
        'src/models/web-server.ts',
        'src/core/web-server.ts',
        'src/core/db-adaptor.ts',
        'src/core/getTestDB.ts',
        'src/index.ts',
        'tests/**',
        'vitest.config*.mts',
      ],
      reporter: ['text', 'json'],
    },
    environment: 'happy-dom',
    exclude: [
      'node_modules/**/**',
      'src/server/**/**',
      'src/repositories/dataImporter/deprecated/**/**',
    ],
    server: {
      deps: {
        inline: ['vitest-canvas-mock'],
      },
    },
    setupFiles: './tests/setup-db.ts',
  },
});
