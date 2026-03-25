import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, './src/test/cloudflare-workers.mock.ts'),
      'hono': path.resolve(__dirname, './src/test/hono.mock.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
