import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/generated/types.gen.ts'],
  fixedExtension: false,
  format: ['esm'],
  outDir: 'dist',
  platform: 'neutral',
  target: 'es2022',
  tsconfig: './tsconfig.json',
});
