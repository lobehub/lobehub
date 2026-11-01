import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(repoRoot, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
  },
});
