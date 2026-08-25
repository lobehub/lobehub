import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        '**/types.ts',
        '**/types/**',
        '**/*.d.ts',
        '**/test/setup.ts',
        '**/vitest.config.*',
        '**/node_modules/**',
      ],
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
  },
});
