import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { stylexPlugin } from '../../plugins/vite/stylex';

export default defineConfig({
  base: './',
  build: { emptyOutDir: true, outDir: path.resolve(import.meta.dirname, 'ui/dist') },
  plugins: [react(), stylexPlugin()],
  root: path.resolve(import.meta.dirname, 'src/report'),
});
