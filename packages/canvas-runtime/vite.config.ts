import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { lobeUiImports } from '../../plugins/vite/lobeUiImports';

const ADDONS = new Set(['highlight', 'mermaid']);

// Each add-on is its own classic script: sandboxed canvas pages have an opaque origin,
// so ES module chunks would need CORS headers from wherever the runtime is hosted.
export default defineConfig(({ mode }) => {
  const addon = ADDONS.has(mode) ? mode : undefined;
  const file = addon ? `canvas-runtime-${addon}` : 'canvas-runtime';

  return {
    build: {
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      emptyOutDir: !addon,
      minify: true,
      lib: {
        entry: addon ? `src/addons/${addon}.ts` : 'src/index.tsx',
        fileName: () => `${file}.js`,
        formats: ['iife'],
        name: addon ? `LobeCanvasAddon_${addon}` : 'LobeCanvasRuntime',
      },
      outDir: 'dist',
      rolldownOptions: {
        output: { assetFileNames: `${file}.css` },
      },
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    // The dev server compiles this config inside a NODE_ENV=development process, which
    // makes oxc emit jsxDEV; the production React selected by `define` has no jsxDEV.
    oxc: { jsx: { development: false } },
    plugins: [react(), ...lobeUiImports()],
  };
});
