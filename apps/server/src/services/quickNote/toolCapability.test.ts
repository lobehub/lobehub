import { describe, expect, it } from 'vitest';

import { isToolCapabilityError } from './toolCapability';

describe('isToolCapabilityError', () => {
  it('accepts errors that say the route cannot do tool calls', () => {
    expect(isToolCapabilityError(new Error('tool_choice is not supported'))).toBe(true);
    expect(isToolCapabilityError({ error: {}, errorType: 'CapabilityNotSupported' })).toBe(true);
    expect(
      isToolCapabilityError({
        error: { message: 'this model does not support tool use' },
        errorType: 'ProviderBizError',
      }),
    ).toBe(true);
  });

  it.each([
    ['InvalidProviderAPIKey'],
    ['InsufficientQuota'],
    ['RateLimitExceeded'],
    ['QuotaLimitReached'],
    ['ProviderNetworkError'],
  ])('rejects %s', (errorType) => {
    expect(isToolCapabilityError({ error: { message: 'tool boom' }, errorType })).toBe(false);
  });

  it('rejects a generic provider error that does not mention tools', () => {
    expect(
      isToolCapabilityError({
        error: { message: 'budget exceeded' },
        errorType: 'ProviderBizError',
      }),
    ).toBe(false);
  });
});
