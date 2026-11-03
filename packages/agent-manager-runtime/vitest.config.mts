import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The runtime imports app stores via `@/*`; tests mock them but the
    // specifiers still need to resolve against the app src directory.
    alias: {
      '@': resolve(__dirname, '../../src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
  },
});
