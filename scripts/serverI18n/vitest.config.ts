import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['scripts/serverI18n/*.test.ts'] },
});
