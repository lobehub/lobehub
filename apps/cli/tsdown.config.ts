import { defineConfig } from 'tsdown';

export default defineConfig({
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  deps: {
    neverBundle: ['@napi-rs/canvas'],
  },
  entry: ['src/index.ts'],
  fixedExtension: false,
  format: ['esm'],
  minify: true,
  outputOptions: {
    codeSplitting: false,
  },
  platform: 'node',
  target: 'node18',
});
