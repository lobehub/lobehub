import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: ['@lobechat/business-const'],
  },
  dts: true,
  entry: [
    'src/index.ts',
    'src/modelProviders/index.ts',
    'src/modelProviders/lobehub.ts',
    'src/types/index.ts',
    'src/aiModels/*.ts',
    // Providers split into a directory (`openai/`, `google/`, …) export their `index.ts`.
    'src/aiModels/*/index.ts',
  ],
  fixedExtension: false,
  format: ['esm'],
  outDir: 'dist',
  platform: 'neutral',
  target: 'es2022',
  tsconfig: './tsconfig.json',
});
