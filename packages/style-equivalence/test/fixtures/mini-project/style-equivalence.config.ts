import react from '@vitejs/plugin-react';

import type { ProjectConfig } from '../../../src/config';
import { cssModulesAdapter } from '../../../src/extract/adapters/cssModules';
import { emotionStaticAdapter } from '../../../src/extract/adapters/emotionStatic';
import { globalCssAdapter } from '../../../src/extract/adapters/globalCss';

const config: ProjectConfig = {
  adapters: [emotionStaticAdapter, cssModulesAdapter, globalCssAdapter],
  aliases: {},
  conditions: { themeAttribute: 'data-theme', themes: ['light', 'dark'], widths: [375, 1280] },
  hostWrapper: 'host.tsx',
  layoutComponents: [],
  vite: async () => ({ plugins: [react()] }),
};

export default config;
