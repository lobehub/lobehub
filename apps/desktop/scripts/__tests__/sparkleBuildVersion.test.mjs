import { describe, expect, it } from 'vitest';

import { toSparkleBuildVersion } from '../sparkleBuildVersion.mjs';

describe('toSparkleBuildVersion', () => {
  it('turns a canary semver into a dash-free, monotonically increasing build number', () => {
    expect(toSparkleBuildVersion('2.2.19-canary.1')).toBe('2.2.19.1');
    expect(toSparkleBuildVersion('2.2.19-canary.12')).toBe('2.2.19.12');
  });

  it('leaves stable and unknown versions untouched', () => {
    expect(toSparkleBuildVersion('2.2.19')).toBe('2.2.19');
    expect(toSparkleBuildVersion('2.2.19-beta.1')).toBe('2.2.19-beta.1');
  });
});
