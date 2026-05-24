import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
export function getNextBuildArgs(isVercel = Boolean(process.env.VERCEL_ENV)) {
  return isVercel ? ['build', '--webpack'] : ['build'];
}

const isVercel = Boolean(process.env.VERCEL_ENV);
const args = getNextBuildArgs(isVercel);

const child = spawn(process.execPath, [nextBin, ...args], {
  env: {
    ...process.env,
    ...(isVercel ? { NODE_OPTIONS: '--max-old-space-size=5632' } : {}),
  },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
