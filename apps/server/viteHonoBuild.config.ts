import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { honoServerDedupe, honoServerPlugins } from './viteNodeServer.config';

const serverRoot = fileURLToPath(new URL('.', import.meta.url));
const entry = (file: string) => fileURLToPath(new URL(`./src/hono/${file}`, import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    rollupOptions: {
      input: {
        index: entry('index.ts'),
        standalone: entry('standalone.ts'),
      },
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    ssr: true,
    target: 'node24',
  },
  plugins: honoServerPlugins(),
  resolve: {
    dedupe: honoServerDedupe,
  },
  root: serverRoot,
  ssr: {
    noExternal: [/^@lobechat\//],
  },
});
