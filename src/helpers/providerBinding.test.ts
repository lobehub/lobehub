import { describe, expect, it } from 'vitest';

import { isProviderBindingTargetSupported, resolveProviderBindingGuard } from './providerBinding';

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

/** @example A personal Codex provider uses the authenticated device transport. */
describe('provider binding device target', () => {
  const provider = {
    type: 'codex',
    authMode: 'api',
    apiConfig: { model: 'api-model', providerId: 'test' },
  } as const;
  // ROOT CAUSE:
  // The composer retained its Desktop-only gate after authenticated device binding dispatch was added.
  // Share target capability with the dispatcher, while retaining provider and device validation.
  /** @example The real device composer is enabled without requiring Desktop IPC. */
  it('allows personal Codex device bindings', () => {
    expect(isProviderBindingTargetSupported('device', provider, false)).toBe(true);
  });
  /** @example Unsupported scopes and runtimes cannot borrow personal credentials. */
  it('keeps workspace, cloud and deployment-default device bindings blocked', () => {
    expect(isProviderBindingTargetSupported('device', provider, true)).toBe(false);
    expect(isProviderBindingTargetSupported('sandbox', provider, false)).toBe(false);
    expect(
      isProviderBindingTargetSupported('device', { ...provider, type: 'claude-code' }, false),
    ).toBe(false);
    expect(
      isProviderBindingTargetSupported(
        'device',
        { ...provider, apiConfig: { source: 'server-default' } },
        false,
      ),
    ).toBe(false);
  });
});
