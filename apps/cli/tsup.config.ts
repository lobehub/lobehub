import { defineConfig } from 'tsup';

export default defineConfig({
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: ['@lobechat/device-gateway-client'],
  platform: 'node',
  target: 'node18',
});
