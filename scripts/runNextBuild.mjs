import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB = 3072;
export const TURBOPACK_VERCEL_PARALLEL = '0';
export const TURBOPACK_VERCEL_DEBUG_FLAGS = ['--debug', '--experimental-debug-memory-usage'];
export const VERCEL_BUILD_SYSTEM_REPORT = '1';
const MAX_OLD_SPACE_SIZE_PATTERN = /--max-old-space-size=\S+/;

function logBuildStep(step, details) {
  if (details) {
    console.error(`[build:next] ${step}`, details);
    return;
  }

  console.error(`[build:next] ${step}`);
}

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
    args.push(...TURBOPACK_VERCEL_DEBUG_FLAGS);
  }

  return [...args, ...extraArgs];
}

export function getVercelBuildEnv(env = process.env) {
  return {
    ...env,
    NODE_OPTIONS: getVercelNodeOptions(env.NODE_OPTIONS),
    TURBOPACK_PARALLEL: env.TURBOPACK_PARALLEL ?? TURBOPACK_VERCEL_PARALLEL,
    VERCEL_BUILD_SYSTEM_REPORT: env.VERCEL_BUILD_SYSTEM_REPORT ?? VERCEL_BUILD_SYSTEM_REPORT,
  };
}

export function runNextBuild({
  argv = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  const isVercel = Boolean(env.VERCEL_ENV);
  const nextBin = require.resolve('next/dist/bin/next');
  const nextArgs = getNextBuildArgs(argv, isVercel);
  const childEnv = isVercel ? getVercelBuildEnv(env) : { ...env };

  logBuildStep('start', {
    env: isVercel
      ? {
          NODE_OPTIONS: childEnv.NODE_OPTIONS,
          TURBOPACK_PARALLEL: childEnv.TURBOPACK_PARALLEL,
          VERCEL_ENV: env.VERCEL_ENV,
        }
      : {
          VERCEL_ENV: env.VERCEL_ENV ?? null,
        },
    nextArgs,
  });

  const child = spawnImpl(process.execPath, [nextBin, ...getNextBuildArgs(argv, isVercel)], {
    env: childEnv,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    logBuildStep('child error', error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      logBuildStep('terminated by signal', signal);
      process.kill(process.pid, signal);
      return;
    }

    logBuildStep('finished', { code: code ?? 1 });
    process.exit(code ?? 1);
  });

  return child;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runNextBuild();
}
