import { defineConfig } from 'vitest/config';

/**
 * Dedicated config: the repo root vitest config excludes dot-directories.
 * Fixtures are inputs for alint, not tests, so they are excluded here even
 * though some carry a `.test-case.ts` suffix for the rule they calibrate.
 */
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'fixtures/**'],
    testTimeout: 180_000,
  },
});
