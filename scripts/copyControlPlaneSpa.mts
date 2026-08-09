import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Publish the Vite control-plane SPA into the Hono app's static directory
 * so `moz` / `dev:control-plane` can serve UI + API on one port (3020).
 */
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(import.meta.dirname, '..');

const distRoot = path.resolve(root, 'dist/control-plane');
const spaDir = path.resolve(root, 'apps/aico-control-plane/web/spa');

if (!existsSync(distRoot)) {
  console.error(`Missing ${distRoot} — run SPA_TARGET=control-plane vite build first`);
  process.exit(1);
}

rmSync(spaDir, { force: true, recursive: true });
mkdirSync(path.dirname(spaDir), { recursive: true });
cpSync(distRoot, spaDir, { recursive: true });

const builtHtml = path.join(spaDir, 'index.controlPlane.html');
const indexHtml = path.join(spaDir, 'index.html');
if (existsSync(builtHtml)) {
  if (existsSync(indexHtml)) rmSync(indexHtml);
  renameSync(builtHtml, indexHtml);
}

if (!existsSync(indexHtml)) {
  console.error(`Missing index.html in ${spaDir}`);
  process.exit(1);
}

console.log(`Copied dist/control-plane -> apps/aico-control-plane/web/spa`);
