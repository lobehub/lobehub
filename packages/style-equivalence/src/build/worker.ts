import { pathToFileURL } from 'node:url';

import { build } from 'vite';

import type { ProjectConfig } from '../config';

const [configFile, root, hostDir, outDir] = process.argv.slice(2);
if (!configFile || !root || !hostDir || !outDir)
  throw new Error('Usage: worker <configFile> <root> <hostDir> <outDir>');

const config = (await import(pathToFileURL(configFile).href)).default as ProjectConfig;
const setup = await config.vite(root);

await build({
  base: './',
  build: {
    chunkSizeWarningLimit: 100_000,
    cssMinify: false,
    emptyOutDir: true,
    minify: false,
    outDir,
    reportCompressedSize: false,
  },
  configFile: false,
  define: setup.define,
  logLevel: 'error',
  plugins: setup.plugins,
  publicDir: false,
  resolve: { alias: setup.alias, dedupe: setup.dedupe, tsconfigPaths: setup.tsconfigPaths },
  root: hostDir,
});
