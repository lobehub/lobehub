import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@/const': resolve(__dirname, '../const/src'),
      '@/utils': resolve(__dirname, './src'),
      '@': resolve(__dirname, '../../src'),

    },
    coverage: {
      all: false,
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
    setupFiles: join(__dirname, './tests/setup.ts'),
  },
});
