import { createRequire } from 'node:module';

/**
 * Single source of truth for this package's own metadata.
 *
 * Must live directly under `src/` (depth 1), the same depth as the bundled
 * entry `dist/index.js`, so `../package.json` resolves to `@lobehub/cli`'s own
 * package.json both when running from source (`bun src/index.ts`) and from the
 * tsdown bundle (`dist/index.js`). A module one directory deeper would resolve
 * the path outside the package once everything is bundled into a single file.
 */
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

export const cliPackageName = pkg.name;
export const cliVersion = pkg.version;
