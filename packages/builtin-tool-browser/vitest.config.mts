import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

import { stylexPluginForVitest } from '../../plugins/vite/stylex';

export default defineConfig({
  plugins: [stylexPluginForVitest()],
  resolve: {
    alias: { '@': resolve(__dirname, '../../src') },
  },
  test: {
    environment: 'node',
  },
});
