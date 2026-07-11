import { describe, expect, it } from 'vitest';

import { latchCapabilities, resolveMessengerCapability } from './useOnboardingCapabilities';

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

describe('latchCapabilities', () => {
  const base = { analysis: false, composio: false, messenger: false, starterTasks: false };

  it('stays true once a capability was observed true, even if the next value is false', () => {
    const afterTrue = latchCapabilities(base, { ...base, messenger: true });
    expect(afterTrue.messenger).toBe(true);

    const afterTransientError = latchCapabilities(afterTrue, { ...base, messenger: false });
    expect(afterTransientError.messenger).toBe(true);
  });

  it('does not flip a capability true before it was ever observed true', () => {
    const result = latchCapabilities(base, { ...base, messenger: false });
    expect(result.messenger).toBe(false);
  });

  it('latches each capability independently', () => {
    const afterComposio = latchCapabilities(base, { ...base, composio: true });
    const afterMessengerDrops = latchCapabilities(afterComposio, { ...base, composio: false });

    expect(afterMessengerDrops).toEqual({
      analysis: false,
      composio: true,
      messenger: false,
      starterTasks: false,
    });
  });
});
