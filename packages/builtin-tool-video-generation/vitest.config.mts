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
    environment: 'happy-dom',
  },
});
