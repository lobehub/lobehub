import path from 'node:path';

import react from '@vitejs/plugin-react';

import type { ProjectConfig } from '../../../src/config';
import { cssModulesAdapter } from '../../../src/extract/adapters/cssModules';

const config: ProjectConfig = {
  adapters: [cssModulesAdapter],
  aliases: {},
  conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [375, 1280] },
  hostWrapper: 'host.tsx',
  layoutComponents: [],
  vite: async () => ({
    alias: [
      {
        find: 'fixture-ui',
        replacement: path.resolve(import.meta.dirname, '../shape-ui/index.tsx'),
      },
    ],
    dedupe: ['react', 'react-dom'],
    plugins: [react()],
  }),
};

export default config;
