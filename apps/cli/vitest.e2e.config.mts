import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    setupFiles: ['./tests/setup.e2e.ts'],
  },
});
