import path from 'node:path';

import { defineConfig } from 'vite';

const appRoot = path.resolve(import.meta.dirname);

// wrangler's own bundler cannot resolve the repo's `@/*` tsconfig paths, so the
// worker is bundled here and `wrangler.jsonc` points at the output.
export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'build/worker',
    rollupOptions: {
      input: path.resolve(appRoot, 'workers/app.ts'),
      output: { entryFileNames: 'index.js', format: 'esm' },
    },
    ssr: true,
    target: 'esnext',
  },
  resolve: { tsconfigPaths: true },
  ssr: { noExternal: true, target: 'webworker' },
});
