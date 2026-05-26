import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const isVercel = Boolean(process.env.VERCEL_ENV);
export function getNextBuildArgs(isVercelBuild = Boolean(process.env.VERCEL_ENV)) {
  const args = ['build'];

  if (isVercelBuild) {
    args.push('--webpack');
  }

  return args;
}

const args = getNextBuildArgs(isVercel);

const child = spawn(process.execPath, [nextBin, ...args], {
  env: {
    ...process.env,
    ...(isVercel ? { NODE_OPTIONS: '--max-old-space-size=6144' } : {}),
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
