import { describe, expect, it } from 'vitest';

import { resolveProviderBindingGuard } from './providerBinding';

describe('resolveProviderBindingGuard', () => {
  it('blocks while provider state is loading', () => {
    expect(resolveProviderBindingGuard({ active: true, isReady: false })).toEqual({
      blocked: true,
      error: undefined,
    });
  });

  it('surfaces a resolved binding error', () => {
    const error = { code: 'configMissing' } as const;
    expect(resolveProviderBindingGuard({ active: true, error, isReady: true })).toEqual({
      blocked: true,
      error,
    });
  });

  it('does not block inactive or valid bindings', () => {
    expect(resolveProviderBindingGuard({ active: false, isReady: false }).blocked).toBe(false);
    expect(resolveProviderBindingGuard({ active: true, isReady: true }).blocked).toBe(false);
  });
});
