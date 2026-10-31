import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Opt-in local tooling tests, separate from the app/server CI projects.
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    environment: 'node',
    hookTimeout: 30_000,
    include: ['scripts/stylexMigration/verification/**/*.test.ts'],
    maxWorkers: 2,
    name: 'stylex-local',
    // CLI contract cases start several bounded subprocesses sequentially.
    testTimeout: 60_000,
  },
});
