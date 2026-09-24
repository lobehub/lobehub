import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * One self-contained script a product includes with a single tag. The major
 * version is part of the path (`dist/v1/…`, CDN `review-sdk/assets/v1/…`) so a
 * breaking change ships beside the old file instead of over it.
 */
export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      fileName: (format) => (format === 'es' ? 'lobehub-review.mjs' : 'lobehub-review.js'),
      formats: ['iife', 'es'],
      name: 'LobeHubReview',
    },
    outDir: 'dist/v1',
    sourcemap: true,
    target: 'es2020',
  },
});
