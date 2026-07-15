import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDevOrchestrator } from './devOrchestrator.mjs';

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(desktopRoot, 'package.json'));

// vite's `exports` map blocks `require.resolve('vite/bin/vite.js')` directly.
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');

// Forward everything after `pnpm dev --` (e.g. --remote-debugging-port=9223) to electron.
const rawArgs = process.argv.slice(2);
const electronArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const cdpPort = Number(process.env.LOBE_DESKTOP_CDP_PORT);
if (
  Number.isInteger(cdpPort) &&
  cdpPort > 0 &&
  !electronArgs.some((arg) => arg.startsWith('--remote-debugging-port'))
) {
  electronArgs.push(`--remote-debugging-port=${cdpPort}`);
}

const orchestrator = createDevOrchestrator({
  desktopRoot,
  electronArgs,
  electronBin: require('electron'),
  viteBin,
  vitePort: Number(process.env.LOBE_DESKTOP_VITE_PORT) || 5173,
});

process.on('SIGINT', () => orchestrator.shutdown(0));
process.on('SIGTERM', () => orchestrator.shutdown(0));

orchestrator.start();
