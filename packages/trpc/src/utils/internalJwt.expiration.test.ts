import { generateKeyPairSync } from 'node:crypto';

import { decodeJwt } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { authEnvMock } = vi.hoisted(() => ({
  authEnvMock: {
    INTERNAL_JWT_EXPIRATION: '30s' as string | undefined,
    JWKS_KEY: '',
  },
}));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));

const lifetimeOf = (token: string) => {
  const { exp, iat } = decodeJwt(token);
  return exp! - iat!;
};

/**
 * Every lambda → async call (image / music generation, file chunking, …) signs this token, so a
 * value jose cannot parse used to fail all of them with `Invalid time period format` (T-14182).
 * Real jose and a real RSA key, so the test exercises jose's own time-span parser.
 */
describe('signInternalJWT expiration', () => {
  beforeAll(() => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    authEnvMock.JWKS_KEY = JSON.stringify({
      keys: [
        { ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'test-key', use: 'sig' },
      ],
    });
  });

  afterEach(() => {
    authEnvMock.INTERNAL_JWT_EXPIRATION = '30s';
    vi.restoreAllMocks();
  });

  it.each([
    ['30s', 30],
    ['2m', 120],
    ['1 hour', 3600],
    // A trailing newline or space pasted into the env var.
    ['5m\n', 300],
    [' 5m ', 300],
  ])('signs with the configured lifetime %j', async (value, seconds) => {
    authEnvMock.INTERNAL_JWT_EXPIRATION = value;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { signInternalJWT } = await import('./internalJwt');

    expect(lifetimeOf(await signInternalJWT())).toBe(seconds);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(['', undefined])('uses the 30s default when unset (%j)', async (value) => {
    authEnvMock.INTERNAL_JWT_EXPIRATION = value;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { signInternalJWT } = await import('./internalJwt');

    expect(lifetimeOf(await signInternalJWT())).toBe(30);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(['30', '30000', '30ms', '"30s"', 'thirty seconds'])(
    'falls back to 30s instead of failing for an unparseable %j',
    async (value) => {
      authEnvMock.INTERNAL_JWT_EXPIRATION = value;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { signInternalJWT, validateInternalJWT } = await import('./internalJwt');

      const token = await signInternalJWT();

      expect(lifetimeOf(token)).toBe(30);
      await expect(validateInternalJWT(token)).resolves.toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('INTERNAL_JWT_EXPIRATION'));
    },
  );

  it('reports an unparseable value once, not on every signed call', async () => {
    authEnvMock.INTERNAL_JWT_EXPIRATION = '45';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { signInternalJWT } = await import('./internalJwt');

    await signInternalJWT();
    await signInternalJWT();
    await signInternalJWT();

    expect(
      errorSpy.mock.calls.filter(([message]) => String(message).includes('"45"')),
    ).toHaveLength(1);
  });
});
