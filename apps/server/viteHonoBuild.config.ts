import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { honoServerAlias, honoServerDedupe, honoServerPlugins } from './viteNodeServer.config';

const serverRoot = fileURLToPath(new URL('.', import.meta.url));
const entry = (file: string) =>
  fileURLToPath(new URL(`./src/router-hono/${file}`, import.meta.url));

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
        // rolldown's default splitting makes the S3 and file chunks import each other, and the
        // S3 chunk then evaluates before the shared `__esmMin` helper exists (500 on every lambda call)
        codeSplitting: { groups: [{ name: 'server', test: /./ }] },
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    ssr: true,
    target: 'node24',
  },
  plugins: honoServerPlugins(),
  resolve: {
    alias: honoServerAlias,
    dedupe: honoServerDedupe,
  },
  root: serverRoot,
  ssr: {
    noExternal: [/^@lobechat\//],
  },
});
