import { describe, expect, it } from 'vitest';

import { normalizeSetTaskVerifyParams } from './setTaskVerify';

describe('normalizeSetTaskVerifyParams', () => {
  it('coerces stringified booleans and integers', () => {
    expect(
      normalizeSetTaskVerifyParams({ enabled: 'true', identifier: 'T-1', maxIterations: '3' }),
    ).toEqual({ enabled: true, identifier: 'T-1', maxIterations: 3 });
    expect(normalizeSetTaskVerifyParams({ enabled: 'False' })).toEqual({ enabled: false });
    expect(normalizeSetTaskVerifyParams({ enabled: 'null', maxIterations: 'null' })).toEqual({
      enabled: null,
      maxIterations: null,
    });
  });

  it('leaves real values and unknown strings untouched', () => {
    expect(normalizeSetTaskVerifyParams({ enabled: true, maxIterations: 2 })).toEqual({
      enabled: true,
      maxIterations: 2,
    });
    expect(normalizeSetTaskVerifyParams({ enabled: 'yes', maxIterations: 'two' })).toEqual({
      enabled: 'yes',
      maxIterations: 'two',
    });
    expect(normalizeSetTaskVerifyParams({ identifier: 'T-1' })).toEqual({ identifier: 'T-1' });
  });
});
