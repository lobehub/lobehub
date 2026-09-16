import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The peer-dep link for react points at the desktop workspace copy, which
    // would give the hook under test a different React than the renderer used
    // by @testing-library/react. Pin both to the root copy.
    alias: {
      react: resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  test: {
    coverage: {
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
