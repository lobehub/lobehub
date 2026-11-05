import stylex from '@stylexjs/unplugin/vite';
import react from '@vitejs/plugin-react';

import type { ProjectConfig } from '../../../src/config';
import { cssModulesAdapter } from '../../../src/extract/adapters/cssModules';
import { emotionStaticAdapter } from '../../../src/extract/adapters/emotionStatic';
import { globalCssAdapter } from '../../../src/extract/adapters/globalCss';
import { stylexAdapter } from '../../../src/extract/adapters/stylex';

const config: ProjectConfig = {
  adapters: [emotionStaticAdapter, stylexAdapter, cssModulesAdapter, globalCssAdapter],
  aliases: {},
  conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [1280] },
  cxFallback: { name: 'cx', source: '@lobehub/ui' },
  hostWrapper: 'host.tsx',
  layoutComponents: [],
  vite: async (root) => ({
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/css', '@stylexjs/stylex'],
    plugins: [
      react(),
      stylex({
        dev: false,
        runtimeInjection: true,
        unstable_moduleResolution: { rootDir: root, type: 'commonJS' },
      }),
    ],
  }),
};

export default config;
