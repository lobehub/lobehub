import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveIdentityFingerprint } from './identity';

const { mockLoadCredentials, mockReadCliApiKeyEnv } = vi.hoisted(() => ({
  mockLoadCredentials: vi.fn<() => { accessToken: string } | null>(),
  mockReadCliApiKeyEnv: vi.fn<() => string | undefined>(),
}));

vi.mock('./credentials', () => ({ loadCredentials: mockLoadCredentials }));
vi.mock('../constants/auth', () => ({ readCliApiKeyEnv: mockReadCliApiKeyEnv }));

const jwtWithSub = (sub: string) =>
  `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`;

describe('resolveIdentityFingerprint', () => {
  const originalJwt = process.env.LOBEHUB_JWT;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOBEHUB_JWT;
    mockLoadCredentials.mockReturnValue(null);
    mockReadCliApiKeyEnv.mockReturnValue(undefined);
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
    else process.env.LOBEHUB_JWT = originalJwt;
  });

  it('returns undefined when there is nothing to authenticate with', () => {
    expect(resolveIdentityFingerprint()).toBeUndefined();
  });

  it('reads the subject out of stored credentials', () => {
    mockLoadCredentials.mockReturnValue({ accessToken: jwtWithSub('user_1') });

    expect(resolveIdentityFingerprint()).toBe('user:user_1');
  });

  it('distinguishes two accounts on the same machine', () => {
    mockLoadCredentials.mockReturnValue({ accessToken: jwtWithSub('user_1') });
    const first = resolveIdentityFingerprint();

    mockLoadCredentials.mockReturnValue({ accessToken: jwtWithSub('user_2') });

    expect(resolveIdentityFingerprint()).not.toBe(first);
  });

  it('prefers the env JWT over stored credentials', () => {
    process.env.LOBEHUB_JWT = jwtWithSub('user_env');
    mockLoadCredentials.mockReturnValue({ accessToken: jwtWithSub('user_stored') });

    expect(resolveIdentityFingerprint()).toBe('user:user_env');
  });

  // An API key has no readable subject, so it is hashed — stable per key, and
  // the key itself never lands in a file the scope record is written to.
  it('fingerprints an API key without storing it', () => {
    mockReadCliApiKeyEnv.mockReturnValue('sk-lh-secret');

    const fingerprint = resolveIdentityFingerprint();

    expect(fingerprint).toMatch(/^apiKey:[\da-f]{16}$/);
    expect(fingerprint).not.toContain('secret');
  });

  it('returns undefined for a token with no parseable subject', () => {
    mockLoadCredentials.mockReturnValue({ accessToken: 'not-a-jwt' });

    expect(resolveIdentityFingerprint()).toBeUndefined();
  });
});
