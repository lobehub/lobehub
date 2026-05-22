import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB = 6144;
const MAX_OLD_SPACE_SIZE_PATTERN = /--max-old-space-size=\S+/;

function getVercelNodeOptions(nodeOptions = '') {
  const maxOldSpaceSizeOption = `--max-old-space-size=${TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB}`;

  if (!nodeOptions.trim()) return maxOldSpaceSizeOption;

  if (MAX_OLD_SPACE_SIZE_PATTERN.test(nodeOptions)) {
    return nodeOptions.replace(MAX_OLD_SPACE_SIZE_PATTERN, maxOldSpaceSizeOption);
  }

  return `${nodeOptions} ${maxOldSpaceSizeOption}`;
}

const isVercel = Boolean(process.env.VERCEL_ENV);
const nextBin = require.resolve('next/dist/bin/next');
const args = ['build'];

if (isVercel) {
  args.push('--turbopack');
}

const child = spawn(process.execPath, [nextBin, ...args], {
  env: {
    ...process.env,
    ...(isVercel ? { NODE_OPTIONS: getVercelNodeOptions(process.env.NODE_OPTIONS) } : {}),
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
