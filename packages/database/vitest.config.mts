import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: {
    exclude: ['crypto', 'util', 'tty'],
    include: ['@lobehub/tts'],
  },
  test: {
    alias: {
      /* eslint-disable sort-keys-fix/sort-keys-fix */
      '@/const': resolve(__dirname, '../const/src'),
      '@/utils/errorResponse': resolve(__dirname, '../../src/utils/errorResponse'),
      '@/utils': resolve(__dirname, '../utils/src'),
      '@/database': resolve(__dirname, '../database/src'),
      '@/libs/model-runtime': resolve(__dirname, '../model-runtime/src'),
      '@/types': resolve(__dirname, '../types/src'),
      '@': resolve(__dirname, '../../src'),
      /* eslint-enable */
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
