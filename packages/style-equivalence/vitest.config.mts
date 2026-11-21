import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'test/fixtures/**'],
    hookTimeout: 60_000,
    testTimeout: 120_000,
  },
});
