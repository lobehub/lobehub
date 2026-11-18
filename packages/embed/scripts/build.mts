/**
 * Bundles the `<script>` loader (`src/auto.ts`) into one dependency-free file
 * served by the app at `/embed.js` (`public/embed.js`, gitignored).
 *
 *   bun run build:embed                 # from the repo root
 *   tsx packages/embed/scripts/build.mts [outfile]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.resolve(packageRoot, '../..');
const require = createRequire(path.join(appRoot, 'package.json'));

export const EMBED_LOADER_OUTFILE = path.join(appRoot, 'public/embed.js');

export const buildEmbedLoader = async (outfile: string = EMBED_LOADER_OUTFILE) => {
  const { build } = require('esbuild') as typeof import('esbuild');

  await build({
    bundle: true,
    entryPoints: [path.join(packageRoot, 'src/auto.ts')],
    format: 'iife',
    legalComments: 'none',
    logLevel: 'warning',
    minify: true,
    outfile,
    platform: 'browser',
    target: ['es2019'],
  });

  console.info(`[embed] built ${path.relative(appRoot, outfile)}`);
  return outfile;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildEmbedLoader(process.argv[2]).catch((error: unknown) => {
    console.error('[embed] build failed:', error);
    process.exit(1);
  });
}
