/**
 * Standalone entry for this repo: `bun run check` routes every file through
 * this repo's own pipelines. When this repo is checked out as a submodule of
 * a superproject that ships its own `check` script, the run is delegated to
 * that entry instead (see `delegate.ts`), so the unified host behavior
 * applies no matter which directory the command is invoked from.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectHostCheckRoot } from './delegate';
import { runCli } from './index';
import { lobehubPipelines } from './pipelines';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const main = async () => {
  const hostRoot = await detectHostCheckRoot(rootDir);
  if (hostRoot) {
    console.log(`→ submodule checkout: delegating to the superproject check (${hostRoot})`);
    // Absolute file args survive the cwd change; flags pass through untouched.
    const args = process.argv
      .slice(2)
      .map((arg) => (arg.startsWith('--') ? arg : path.resolve(process.cwd(), arg)));
    const child = spawn('bun', ['run', 'check', ...args], { cwd: hostRoot, stdio: 'inherit' });
    child.on('close', (code) => process.exit(code ?? 1));
    return;
  }

  await runCli({
    repos: [{ baseRef: 'origin/canary', dir: '', pipelines: lobehubPipelines }],
    rootDir,
  });
};

main().catch((error) => {
  console.error(`✗ check crashed: ${error?.stack ?? error}`);
  process.exit(2);
});
