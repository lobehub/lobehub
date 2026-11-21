import { generateKeyPairSync } from 'node:crypto';

import { calculateJwkThumbprint, decodeProtectedHeader, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { authEnvMock } = vi.hoisted(() => ({
  authEnvMock: {
    INTERNAL_JWT_EXPIRATION: '30s',
    JWKS_KEY: '',
  },
}));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));

const createRsaKey = (kid: string) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  return {
    kid,
    privateJwk: {
      ...privateKey.export({ format: 'jwk' }),
      alg: 'RS256',
      kid,
      use: 'sig',
    },
    privateKey,
    publicJwk: {
      ...publicKey.export({ format: 'jwk' }),
      alg: 'RS256',
      kid,
      use: 'sig',
    },
  };
};

describe('internal JWT key rotation', () => {
  const keys = {
    new: createRsaKey('new-key'),
    old: createRsaKey('old-key'),
  };

  beforeAll(() => {
    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.old.privateJwk, keys.new.privateJwk] });
  });

  const signToken = (key: (typeof keys)[keyof typeof keys], kid: string | null = key.kid) =>
    new SignJWT({ purpose: 'lobe-internal-call' })
      .setProtectedHeader(kid === null ? { alg: 'RS256' } : { alg: 'RS256', kid })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey);

  const signHeteroToken = (key: (typeof keys)[keyof typeof keys], kid: string | null = key.kid) =>
    new SignJWT({
      capabilities: ['hetero:finish'],
      operation_id: 'operation-1',
      purpose: 'hetero-operation',
    })
      .setProtectedHeader(kid === null ? { alg: 'RS256' } : { alg: 'RS256', kid })
      .setIssuer('urn:lobehub:internal')
      .setAudience('urn:lobehub:hetero-operation')
      .setSubject('user-1')
      .setJti('jwt-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey);

  it.each(['old', 'new'] as const)('verifies a token signed with the %s key', async (name) => {
    const { validateInternalJWT } = await import('./internalJwt');

    await expect(validateInternalJWT(await signToken(keys[name]))).resolves.toBe(true);
  });

  it.each(['old', 'new'] as const)(
    'verifies a hetero operation token signed with the %s key',
    async (name) => {
      const { validateHeteroOperationJWT } = await import('./internalJwt');

      await expect(
        validateHeteroOperationJWT(await signHeteroToken(keys[name])),
      ).resolves.toMatchObject({
        operation_id: 'operation-1',
        sub: 'user-1',
      });
    },
  );

  it('uses the first RS256 private key for signing', async () => {
    const { signInternalJWT } = await import('./internalJwt');

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.old.privateJwk, keys.new.privateJwk] });
    expect(decodeProtectedHeader(await signInternalJWT()).kid).toBe('old-key');

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.new.privateJwk, keys.old.privateJwk] });
    expect(decodeProtectedHeader(await signInternalJWT()).kid).toBe('new-key');
  });

  it('derives a stable kid for a legacy key that omits one', async () => {
    const { signInternalJWT, validateInternalJWT } = await import('./internalJwt');
    const { kid: _kid, ...legacyPrivateJwk } = keys.old.privateJwk;
    const expectedKid = await calculateJwkThumbprint(legacyPrivateJwk);

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [legacyPrivateJwk] });
    const token = await signInternalJWT();

    expect(decodeProtectedHeader(token).kid).toBe(expectedKid);
    await expect(validateInternalJWT(token)).resolves.toBe(true);

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.old.privateJwk, keys.new.privateJwk] });
  });

  it('verifies in-flight tokens without kid after a second key is added', async () => {
    const { validateHeteroOperationJWT, validateInternalJWT } = await import('./internalJwt');

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.old.privateJwk, keys.new.privateJwk] });

    await expect(validateInternalJWT(await signToken(keys.old, null))).resolves.toBe(true);
    await expect(
      validateHeteroOperationJWT(await signHeteroToken(keys.old, null)),
    ).resolves.toMatchObject({ operation_id: 'operation-1', sub: 'user-1' });
  });

  describe('a rejected token', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs that it expired, with the timing claims but not the token', async () => {
      const { validateInternalJWT } = await import('./internalJwt');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const iat = Math.floor(Date.now() / 1000) - 60;
      const token = await new SignJWT({ purpose: 'lobe-internal-call' })
        .setProtectedHeader({ alg: 'RS256', kid: keys.new.kid })
        .setIssuedAt(iat)
        .setExpirationTime(iat + 5)
        .sign(keys.new.privateKey);

      await expect(validateInternalJWT(token)).resolves.toBe(false);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('internal call token'),
        expect.objectContaining({ code: 'ERR_JWT_EXPIRED', exp: iat + 5, iat, kid: 'new-key' }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    });

    it('logs a key the JWKS no longer holds', async () => {
      const { validateInternalJWT } = await import('./internalJwt');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const retired = createRsaKey('retired-key');

      await expect(validateInternalJWT(await signToken(retired))).resolves.toBe(false);

      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: 'ERR_JWKS_NO_MATCHING_KEY', kid: 'retired-key' }),
      );
    });
  });
});
