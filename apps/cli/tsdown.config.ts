import { defineConfig } from 'tsdown';

export default defineConfig({
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  deps: {
    // The desktop app executes this bundle directly from Resources/bin, where
    // the published package's node_modules tree does not exist. Keep the only
    // production dependency inside the bundle so the embedded CLI is truly
    // self-contained instead of failing at startup with ERR_MODULE_NOT_FOUND.
    alwaysBundle: ['ws'],
    neverBundle: ['@napi-rs/canvas'],
  },
  entry: ['src/index.ts'],
  fixedExtension: false,
  format: ['esm'],
  minify: !!process.env.MINIFY,
  outputOptions: {
    codeSplitting: false,
  },
  platform: 'node',
  target: 'node18',
});
