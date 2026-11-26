import { defineConfig } from 'vitest/config';

import { stylexPluginForVitest } from '../../plugins/vite/stylex';

export default defineConfig({
  plugins: [stylexPluginForVitest()],
  test: {
    environment: 'node',
    server: {
      deps: {
        inline: [/@lobehub\//],
      },
    },
  },
});
