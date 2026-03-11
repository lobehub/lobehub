import { defineConfig } from 'tsup';

export default defineConfig({
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  entry: ['src/index.ts'],
  external: ['@napi-rs/canvas', 'fast-glob', 'diff', 'debug'],
  format: ['esm'],
  noExternal: [
    '@lobechat/device-gateway-client',
    '@lobechat/local-file-shell',
    '@lobechat/file-loaders',
    '@trpc/client',
    'superjson',
  ],
  platform: 'node',
  target: 'node18',
});
