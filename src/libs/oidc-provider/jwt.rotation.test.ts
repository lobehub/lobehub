import { generateKeyPairSync } from 'node:crypto';

import { calculateJwkThumbprint, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { authEnvMock } = vi.hoisted(() => ({
  authEnvMock: { JWKS_KEY: '' },
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

describe('OIDC JWT key rotation', () => {
  const acceptanceId = '7f0c9a7e-0000-4000-8000-000000000001';
  const keys = {
    new: createRsaKey('new-key'),
    old: createRsaKey('old-key'),
  };

  beforeAll(() => {
    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.old.privateJwk, keys.new.privateJwk] });
  });

  const signToken = (key: (typeof keys)[keyof typeof keys], kid: string | null = key.kid) =>
    new SignJWT({ client_id: 'lobehub-desktop' })
      .setProtectedHeader(kid === null ? { alg: 'RS256' } : { alg: 'RS256', kid })
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey);

  const signAcceptanceReviewToken = (
    key: (typeof keys)[keyof typeof keys],
    kid: string | null = key.kid,
  ) =>
    new SignJWT({ client_id: 'lobehub-review' })
      .setProtectedHeader(kid === null ? { alg: 'RS256' } : { alg: 'RS256', kid })
      .setAudience(`urn:lobehub:acceptance:${acceptanceId}`)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey);

  it.each(['old', 'new'] as const)('verifies a token signed with the %s key', async (name) => {
    const { validateOIDCJWT } = await import('./jwt');

    await expect(validateOIDCJWT(await signToken(keys[name]))).resolves.toMatchObject({
      userId: 'user-1',
    });
  });

  it.each(['old', 'new'] as const)(
    'verifies an acceptance review token signed with the %s key',
    async (name) => {
      const { verifyAcceptanceReviewJWT } = await import('./jwt');

      await expect(
        verifyAcceptanceReviewJWT(await signAcceptanceReviewToken(keys[name])),
      ).resolves.toMatchObject({ acceptanceId, userId: 'user-1' });
    },
  );

  it('rejects a token whose kid is not in the configured JWKS', async () => {
    const { validateOIDCJWT } = await import('./jwt');

    await expect(validateOIDCJWT(await signToken(keys.old, 'unknown-key'))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('verifies the derived kid used by oidc-provider for a legacy key', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const { kid: _kid, ...legacyPrivateJwk } = keys.old.privateJwk;
    const expectedKid = await calculateJwkThumbprint(legacyPrivateJwk);

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [legacyPrivateJwk] });
    await expect(validateOIDCJWT(await signToken(keys.old, expectedKid))).resolves.toMatchObject({
      userId: 'user-1',
    });

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.old.privateJwk, keys.new.privateJwk] });
  });

  it('verifies in-flight tokens without kid after a second key is added', async () => {
    const { validateOIDCJWT, verifyAcceptanceReviewJWT } = await import('./jwt');

    authEnvMock.JWKS_KEY = JSON.stringify({ keys: [keys.old.privateJwk, keys.new.privateJwk] });

    await expect(validateOIDCJWT(await signToken(keys.old, null))).resolves.toMatchObject({
      userId: 'user-1',
    });
    await expect(
      verifyAcceptanceReviewJWT(await signAcceptanceReviewToken(keys.old, null)),
    ).resolves.toMatchObject({ acceptanceId, userId: 'user-1' });
  });
});
