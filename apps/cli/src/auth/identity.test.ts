import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveIdentityFingerprint } from './identity';

const { mockLoadCredentials } = vi.hoisted(() => ({
  mockLoadCredentials: vi.fn<() => { accessToken: string } | null>(),
}));

vi.mock('./credentials', () => ({ loadCredentials: mockLoadCredentials }));

const jwtWithSub = (sub: string) =>
  `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`;

describe('resolveIdentityFingerprint', () => {
  const originalJwt = process.env.LOBEHUB_JWT;
  const originalApiKey = process.env.LOBEHUB_CLI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOBEHUB_JWT;
    mockLoadCredentials.mockReturnValue(null);
    delete process.env.LOBEHUB_CLI_API_KEY;
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
    else process.env.LOBEHUB_JWT = originalJwt;
    if (originalApiKey === undefined) delete process.env.LOBEHUB_CLI_API_KEY;
    else process.env.LOBEHUB_CLI_API_KEY = originalApiKey;
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

  // An API key has no readable subject. Digesting the key to make one would put
  // a secret-derived artifact on disk, so this mode has no identity at all.
  it('has no identity for API-key credentials', () => {
    process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-secret';

    expect(resolveIdentityFingerprint()).toBeUndefined();
  });

  // The request authenticates as the API key's owner, so reading past it to the
  // stored login would bind the scope to a different account than the caller.
  it('does not fall back to the stored login when an API key is set', () => {
    process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-secret';
    mockLoadCredentials.mockReturnValue({ accessToken: jwtWithSub('user_1') });

    expect(resolveIdentityFingerprint()).toBeUndefined();
  });

  it('returns undefined for a token with no parseable subject', () => {
    mockLoadCredentials.mockReturnValue({ accessToken: 'not-a-jwt' });

    expect(resolveIdentityFingerprint()).toBeUndefined();
  });
});
