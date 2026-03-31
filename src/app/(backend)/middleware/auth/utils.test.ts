import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAuthMethod } from './utils';

describe('checkAuthMethod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass with valid Better Auth session', () => {
    expect(() =>
      checkAuthMethod({
        betterAuthAuthorized: true,
      }),
    ).not.toThrow();
  });

  it('should pass with valid API key', () => {
    expect(() =>
      checkAuthMethod({
        apiKey: 'someApiKey',
      }),
    ).not.toThrow();
  });

  it('should throw Unauthorized with no auth params', () => {
    expect(() => checkAuthMethod({})).toThrow();
  });

  it('should throw Unauthorized when betterAuthAuthorized is false and no apiKey', () => {
    expect(() =>
      checkAuthMethod({
        betterAuthAuthorized: false,
      }),
    ).toThrow();
  });
});
