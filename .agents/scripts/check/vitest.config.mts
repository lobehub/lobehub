import { defineConfig } from 'vitest/config';

/**
 * Dedicated config: the repo root vitest config excludes dot-directories and
 * carries a DOM environment + heavy setup this plain Node script doesn't
 * want. The check engine's own nearest-config routing picks this file up, so
 * `bun run check` runs these tests from here automatically.
 */
export default defineConfig({
  test: {
    environment: 'node',
  },
});
