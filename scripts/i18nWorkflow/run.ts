/**
 * Runs the i18n workflow for both the main app and desktop app in parallel.
 *
 * Usage:
 *   tsx ./scripts/i18nWorkflow/run.ts
 *
 * Each target spawns its own `index.ts` process with the appropriate root path,
 * so they run concurrently and print interleaved but labeled output.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../..');

interface Target {
  label: string;
  root: string;
}

const targets: Target[] = [
  { label: 'web', root: repoRoot },
  { label: 'desktop', root: resolve(repoRoot, 'apps/desktop') },
];

const runWorkflow = (target: Target): Promise<void> =>
  new Promise((res, rej) => {
    const prefix = `[${target.label.toUpperCase()}]`;

    const child = spawn('bun', ['run', 'i18n'], {
      cwd: target.root,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        res();
      } else {
        rej(new Error(`${prefix} exited with code ${code}`));
      }
    });
  });

Promise.all(targets.map(runWorkflow)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
