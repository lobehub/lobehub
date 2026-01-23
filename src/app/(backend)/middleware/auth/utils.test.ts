import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAuthMethod } from './utils';

let enableNextAuthMock = false;
let enableBetterAuthMock = false;

vi.mock('@/envs/auth', async (importOriginal) => {
  const data = await importOriginal();

  return {
    ...(data as any),
    get enableBetterAuth() {
      return enableBetterAuthMock;
    },
    get enableNextAuth() {
      return enableNextAuthMock;
    },
  };
});

describe('checkAuthMethod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass with valid Next auth', () => {
    enableNextAuthMock = true;
    expect(() =>
      checkAuthMethod({
        nextAuthAuthorized: true,
      }),
    ).not.toThrow();

    enableNextAuthMock = false;
  });

  it('should pass with valid Better Auth session', () => {
    enableBetterAuthMock = true;

    expect(() =>
      checkAuthMethod({
        betterAuthAuthorized: true,
      }),
    ).not.toThrow();

    enableBetterAuthMock = false;
  });

  it('should pass with valid API key', () => {
    expect(() =>
      checkAuthMethod({
        apiKey: 'someApiKey',
      }),
    ).not.toThrow();
  });

  it('should pass with no auth params', () => {
    expect(() => checkAuthMethod({})).not.toThrow();
  });
});
