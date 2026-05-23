import { describe, expect, it } from 'vitest';

import {
  TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB,
  TURBOPACK_VERCEL_PARALLEL,
  TURBOPACK_VERCEL_DEBUG_FLAGS,
  getNextBuildArgs,
  getVercelBuildEnv,
  getVercelNodeOptions,
  VERCEL_BUILD_SYSTEM_REPORT,
} from './runNextBuild.mjs';

describe('runNextBuild helpers', () => {
  it('should replace the Vercel max old space size override', () => {
    expect(getVercelNodeOptions('--max-old-space-size=8192 --trace-warnings')).toBe(
      `--max-old-space-size=${TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB} --trace-warnings`,
    );
  });

  it('should append the Vercel max old space size override when missing', () => {
    expect(getVercelNodeOptions('--trace-warnings')).toBe(
      `--trace-warnings --max-old-space-size=${TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB}`,
    );
  });

  it('should forward extra next build arguments on Vercel', () => {
    expect(getNextBuildArgs(['--debug-prerender', '--no-lint'], true)).toEqual([
      'build',
      '--turbopack',
      ...TURBOPACK_VERCEL_DEBUG_FLAGS,
      '--debug-prerender',
      '--no-lint',
    ]);
  });

  it('should keep non-Vercel builds on the default next build path', () => {
    expect(getNextBuildArgs(['--debug-prerender'], false)).toEqual([
      'build',
      '--debug-prerender',
    ]);
  });

  it('should add the Vercel parallelism override', () => {
    expect(getVercelBuildEnv({ VERCEL_ENV: 'production' }).TURBOPACK_PARALLEL).toBe(
      TURBOPACK_VERCEL_PARALLEL,
    );
  });

  it('should enable Vercel build system reports by default', () => {
    expect(getVercelBuildEnv({ VERCEL_ENV: 'production' }).VERCEL_BUILD_SYSTEM_REPORT).toBe(
      VERCEL_BUILD_SYSTEM_REPORT,
    );
  });
});
