import { defineConfig } from 'vitest/config';

import { stylexPluginForVitest } from '../../plugins/vite/stylex';

export default defineConfig({
  plugins: [stylexPluginForVitest()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
