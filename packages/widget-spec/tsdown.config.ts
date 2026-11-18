import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: { eager: true },
  entry: ['src/index.ts'],
  // Always .mjs / .d.mts, matching `publishConfig.exports`.
  fixedExtension: true,
  format: ['esm'],
  // The widget types and constants come from the private `@lobechat/types`
  // workspace package: inline them so the published package stands alone.
  deps: { alwaysBundle: ['@lobechat/types'] },
  outDir: 'dist',
  platform: 'neutral',
  target: 'es2022',
  tsconfig: './tsconfig.json',
});
