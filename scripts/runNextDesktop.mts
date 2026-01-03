import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const isDesktop = process.env.NEXT_PUBLIC_IS_DESKTOP_APP === '1';

if (isDesktop) {
  const envDesktop = path.resolve(process.cwd(), '.env.desktop');
  const envDesktopLocal = path.resolve(process.cwd(), '.env.desktop.local');

  if (existsSync(envDesktop)) dotenvExpand.expand(dotenv.config({ path: envDesktop }));
  if (existsSync(envDesktopLocal))
    dotenvExpand.expand(dotenv.config({ override: true, path: envDesktopLocal }));
}

const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const args = process.argv.slice(2);

const child = spawn(process.execPath, [nextBin, ...args], {
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exitCode = code;
    return;
  }

  process.exitCode = signal ? 1 : 0;
});
