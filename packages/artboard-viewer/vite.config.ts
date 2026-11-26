import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { lobeIconImports } from '../../plugins/vite/lobeIconImports';
import { lobeUiImports } from '../../plugins/vite/lobeUiImports';
import { vitePlatformResolve } from '../../plugins/vite/platformResolve';
import {
  sharedRendererDedupe,
  sharedRendererDefine,
} from '../../plugins/vite/sharedRendererConfig';
import { stylexPlugin, stylexTokenModules } from '../../plugins/vite/stylex';
import { findForbiddenModules } from './scripts/gate.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const boardOnlyGate = (): Plugin => ({
  generateBundle() {
    const forbidden = findForbiddenModules([...this.getModuleIds()], repoRoot);
    if (forbidden.length)
      this.error(`The artboard viewer must not bundle app-only modules:\n${forbidden.join('\n')}`);
  },
  name: 'artboard-viewer-gate',
});

// A classic script: published sites load it cross-origin, so ES module chunks would need CORS.
export default defineConfig({
  build: {
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: 'src/index.tsx',
      fileName: () => 'artboard-viewer.js',
      formats: ['iife'],
      name: 'LobeArtboardViewer',
    },
    minify: true,
    outDir: 'dist',
    rolldownOptions: {
      output: { assetFileNames: 'artboard-viewer.css' },
    },
  },
  define: {
    ...sharedRendererDefine({ isElectron: false, isMobile: false }),
    'process.env.NODE_ENV': '"production"',
  },
  optimizeDeps: { exclude: [...stylexTokenModules] },
  oxc: { jsx: { development: false } },
  plugins: [
    boardOnlyGate(),
    vitePlatformResolve('web'),
    stylexPlugin(),
    react(),
    ...lobeUiImports(),
    ...lobeIconImports(),
  ],
  resolve: {
    dedupe: [...sharedRendererDedupe, '@lobehub/ui'],
    tsconfigPaths: true,
  },
});
