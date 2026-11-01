import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/generated/types.gen.ts'],
  // Always emit .mjs/.d.mts regardless of package.json "type" — the release
  // workflow rewrites exports to ./dist/*.mjs and must never drift from the
  // actual output extension.
  fixedExtension: true,
  format: ['esm'],
  outDir: 'dist',
  platform: 'neutral',
  target: 'es2022',
  tsconfig: './tsconfig.json',
});
