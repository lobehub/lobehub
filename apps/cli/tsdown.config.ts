import { defineConfig } from 'tsdown';

export default defineConfig({
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  deps: {
    alwaysBundle: [
      '@lobechat/device-gateway-client',
      '@lobechat/file-loaders',
      '@lobechat/local-file-shell',
      '@trpc/client',
      'superjson',
    ],
    neverBundle: ['@napi-rs/canvas', 'debug', 'diff', 'fast-glob'],
  },
  entry: ['src/index.ts'],
  fixedExtension: false,
  format: ['esm'],
  platform: 'node',
  target: 'node18',
});
