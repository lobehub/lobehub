import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAuthConfig } from './auth';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_WINDOW = globalThis.window;

describe('getAuthConfig fallbacks', () => {
  beforeEach(() => {
    // reset env to a clean clone before each test
    process.env = { ...ORIGINAL_ENV };
    globalThis.window = ORIGINAL_WINDOW;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.window = ORIGINAL_WINDOW;
  });

  it('should fall back to NEXT_AUTH_SSO_PROVIDERS when AUTH_SSO_PROVIDERS is empty string', () => {
    process.env.AUTH_SSO_PROVIDERS = '';
    process.env.NEXT_AUTH_SSO_PROVIDERS = 'logto,github';

    // Simulate server runtime so @t3-oss/env treats this as server-side access
    // (happy-dom sets window by default in Vitest)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - allow overriding for test
    globalThis.window = undefined;

    const config = getAuthConfig();

    expect(config.AUTH_SSO_PROVIDERS).toBe('logto,github');
  });

  it('should fall back to NEXT_AUTH_SECRET when AUTH_SECRET is empty string', () => {
    process.env.AUTH_SECRET = '';
    process.env.NEXT_AUTH_SECRET = 'nextauth-secret';

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - allow overriding for test
    globalThis.window = undefined;

    const config = getAuthConfig();

    expect(config.AUTH_SECRET).toBe('nextauth-secret');
  });
});
