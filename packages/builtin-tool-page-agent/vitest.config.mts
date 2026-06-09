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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
    server: {
      deps: {
        // Inline @emoji-mart packages to avoid ESM JSON import issues
        inline: [/@emoji-mart/, /@lobehub\/ui/],
      },
    },
  },
});
