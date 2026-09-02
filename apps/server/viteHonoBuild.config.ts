import { cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

import { honoNativeExternals } from './honoExternals';
import { honoServerAlias, honoServerDedupe, honoServerPlugins } from './viteNodeServer.config';

const serverRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = path.join(serverRoot, 'dist');
const entry = (file: string) =>
  fileURLToPath(new URL(`./src/router-hono/${file}`, import.meta.url));
const require = createRequire(import.meta.url);

// pdfkit reads its AFM font metrics from `__dirname + '/data'` at runtime
const pdfkitFontsPlugin: Plugin = {
  closeBundle() {
    cpSync(path.join(path.dirname(require.resolve('pdfkit')), 'data'), path.join(outDir, 'data'), {
      recursive: true,
    });
  },
  name: 'lobe-hono-pdfkit-fonts',
};

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir,
    rollupOptions: {
      external: honoNativeExternals,
      input: {
        index: entry('index.ts'),
        standalone: entry('standalone.ts'),
      },
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        codeSplitting: {
          // rolldown's default splitting makes the S3 and file chunks import each other, and the
          // S3 chunk then evaluates before the shared `__esmMin` helper exists (500 on every lambda call)
          groups: [{ name: 'server', test: /./ }],
        },
        entryFileNames: '[name].js',
        format: 'es',
      },
      // @peculiar/x509 imports the reflect-metadata polyfill for tsyringe; rolldown drops that
      // bare side-effect import unless the module is marked as effectful
      treeshake: { moduleSideEffects: [{ sideEffects: true, test: /reflect-metadata/ }] },
    },
    ssr: true,
    target: 'node24',
  },
  // CommonJS dependencies inlined into the ESM bundle still reference __dirname / __filename
  define: { __dirname: 'import.meta.dirname', __filename: 'import.meta.filename' },
  plugins: [...honoServerPlugins(), pdfkitFontsPlugin],
  resolve: {
    alias: honoServerAlias,
    dedupe: honoServerDedupe,
  },
  root: serverRoot,
  ssr: {
    noExternal: true,
  },
});
