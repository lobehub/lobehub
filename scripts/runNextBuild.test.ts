import { describe, expect, it } from 'vitest';

import {
  getNextBuildArgs,
  getVercelBuildEnv,
  getVercelNodeOptions,
  VERCEL_BUILD_SYSTEM_REPORT,
  WEBPACK_VERCEL_BUILD_FLAGS,
  WEBPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB,
} from './runNextBuild.mjs';

describe('runNextBuild helpers', () => {
  it('should replace the Vercel max old space size override', () => {
    expect(getVercelNodeOptions('--max-old-space-size=8192 --trace-warnings')).toBe(
      `--max-old-space-size=${WEBPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB} --trace-warnings`,
    );
  });

  it('should append the Vercel max old space size override when missing', () => {
    expect(getVercelNodeOptions('--trace-warnings')).toBe(
      `--trace-warnings --max-old-space-size=${WEBPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB}`,
    );
  });

  it('should forward extra next build arguments on Vercel', () => {
    expect(getNextBuildArgs(['--debug-prerender', '--no-lint'], true)).toEqual([
      'build',
      ...WEBPACK_VERCEL_BUILD_FLAGS,
      '--debug-prerender',
      '--no-lint',
    ]);
  });

  it('should keep non-Vercel builds on the default next build path', () => {
    expect(getNextBuildArgs(['--debug-prerender'], false)).toEqual(['build', '--debug-prerender']);
  });

  it('should enable Vercel build system reports by default', () => {
    expect(getVercelBuildEnv({ VERCEL_ENV: 'production' }).VERCEL_BUILD_SYSTEM_REPORT).toBe(
      VERCEL_BUILD_SYSTEM_REPORT,
    );
  });
});
