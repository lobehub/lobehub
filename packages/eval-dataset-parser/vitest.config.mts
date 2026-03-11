import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        '**/types.ts',
        '**/*.d.ts',
        '**/vitest.config.*',
        '**/node_modules/**',
      ],
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
