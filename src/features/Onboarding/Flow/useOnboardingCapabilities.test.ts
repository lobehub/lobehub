import { describe, expect, it } from 'vitest';

import { resolveMessengerCapability } from './useOnboardingCapabilities';

describe('resolveMessengerCapability', () => {
  it('is true when the server reports at least one available platform', () => {
    expect(resolveMessengerCapability([{ id: 'slack' }], undefined)).toBe(true);
  });

  it('is false when the platforms list is empty', () => {
    expect(resolveMessengerCapability([], undefined)).toBe(false);
  });

  it('is false while the fetch is still pending (data undefined)', () => {
    expect(resolveMessengerCapability(undefined, undefined)).toBe(false);
  });

  it('is false when the fetch errors, even if stale data is present', () => {
    expect(resolveMessengerCapability([{ id: 'slack' }], new Error('network'))).toBe(false);
  });
});
