import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEV_AUTH_BYPASS_HEADER, getDevAuthBypassToken, isDevAuthBypassRequest } from './devAuth';

const bypassToken = 'dev-auth-bypass-token-at-least-32-characters';

describe('development auth bypass', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts the configured token only with explicit development opt-in', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_AUTH_BYPASS', '1');
    vi.stubEnv('DEV_AUTH_BYPASS_SECRET', bypassToken);

    expect(getDevAuthBypassToken()).toBe(bypassToken);
    expect(isDevAuthBypassRequest(new Headers({ [DEV_AUTH_BYPASS_HEADER]: bypassToken }))).toBe(
      true,
    );
  });

  it.each([
    {
      configuredToken: bypassToken,
      enabled: undefined,
      name: 'explicit opt-in is missing',
      requestToken: bypassToken,
    },
    {
      configuredToken: 'too-short',
      enabled: '1',
      name: 'the configured token is too short',
      requestToken: 'too-short',
    },
    {
      configuredToken: bypassToken,
      enabled: '1',
      name: 'the request uses the legacy spoofable value',
      requestToken: '1',
    },
  ])('rejects the request when $name', ({ configuredToken, enabled, requestToken }) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_AUTH_BYPASS', enabled);
    vi.stubEnv('DEV_AUTH_BYPASS_SECRET', configuredToken);

    expect(isDevAuthBypassRequest(new Headers({ [DEV_AUTH_BYPASS_HEADER]: requestToken }))).toBe(
      false,
    );
  });
});
