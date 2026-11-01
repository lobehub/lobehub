import { defineConfig } from 'vitest/config';

/**
 * Package config: plain Node environment, and fixtures are excluded because
 * they are inputs for alint, not tests, even when they carry a `.test-case.ts`
 * suffix for the rule they calibrate.
 */
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'fixtures/**'],
    testTimeout: 180_000,
  },
});
