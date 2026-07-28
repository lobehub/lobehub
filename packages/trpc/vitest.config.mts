import { resolve } from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.json'] })],
  resolve: {
    alias: {
      '@lobechat/utils/server': resolve(__dirname, '../utils/src/server/index.ts'),
      '@/utils/devAuth': resolve(__dirname, '../utils/src/devAuth.ts'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
