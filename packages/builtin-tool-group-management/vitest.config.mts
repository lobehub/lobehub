import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(repoRoot, 'src'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', ['lcov', { projectRoot: repoRoot }], 'text-summary'],
    },
    environment: 'node',
  },
});
