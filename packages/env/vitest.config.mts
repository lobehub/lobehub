import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@/const': resolve(__dirname, '../const/src'),
      '@lobechat/types': resolve(__dirname, '../types/src'),
      '@': resolve(__dirname, '../../src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
