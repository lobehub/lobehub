import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB = 6144;
const MAX_OLD_SPACE_SIZE_PATTERN = /--max-old-space-size=\S+/;

export function getVercelNodeOptions(nodeOptions = '') {
  const maxOldSpaceSizeOption = `--max-old-space-size=${TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB}`;

  if (!nodeOptions.trim()) return maxOldSpaceSizeOption;

  if (MAX_OLD_SPACE_SIZE_PATTERN.test(nodeOptions)) {
    return nodeOptions.replace(MAX_OLD_SPACE_SIZE_PATTERN, maxOldSpaceSizeOption);
  }

  return `${nodeOptions} ${maxOldSpaceSizeOption}`;
}

export function getNextBuildArgs(extraArgs = [], isVercel = Boolean(process.env.VERCEL_ENV)) {
  const args = ['build'];

  if (isVercel) {
    args.push('--turbopack');
  }

  return [...args, ...extraArgs];
}

export function runNextBuild({
  argv = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  const isVercel = Boolean(env.VERCEL_ENV);
  const nextBin = require.resolve('next/dist/bin/next');
  const child = spawnImpl(process.execPath, [nextBin, ...getNextBuildArgs(argv, isVercel)], {
    env: {
      ...env,
      ...(isVercel ? { NODE_OPTIONS: getVercelNodeOptions(env.NODE_OPTIONS) } : {}),
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

  return child;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runNextBuild();
}
