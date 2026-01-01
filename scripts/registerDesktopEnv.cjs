/**
 * Desktop env preloader for Next.js.
 *
 * Why: Next.js only auto-loads `.env*` (e.g. `.env`, `.env.local`, `.env.development`),
 * but our desktop build expects `.env.desktop`.
 *
 * This file is intended to be used via Node's `-r` (require) flag so it runs
 * BEFORE Next.js loads its own env config:
 *
 *   node -r ./scripts/registerDesktopEnv.cjs ./node_modules/next/dist/bin/next build
 */

const path = require('node:path');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const fs = require('node:fs');

const isDesktop = process.env.NEXT_PUBLIC_IS_DESKTOP_APP === '1';

if (isDesktop) {
  const cwd = process.cwd();

  const envDesktop = path.join(cwd, '.env.desktop');
  const envDesktopLocal = path.join(cwd, '.env.desktop.local');

  if (fs.existsSync(envDesktop)) dotenvExpand.expand(dotenv.config({ path: envDesktop }));
  if (fs.existsSync(envDesktopLocal))
    dotenvExpand.expand(dotenv.config({ override: true, path: envDesktopLocal }));
}
