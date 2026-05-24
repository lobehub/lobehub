import { describe, expect, it } from 'vitest';

import { getNextBuildArgs } from './runNextBuild.mjs';

describe('runNextBuild', () => {
  it('should keep non-Vercel builds on the default next build path', () => {
    expect(getNextBuildArgs(false)).toEqual(['build']);
  });

  it('should use webpack only for Vercel builds', () => {
    expect(getNextBuildArgs(true)).toEqual(['build', '--webpack']);
  });
});
