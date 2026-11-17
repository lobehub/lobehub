import { generateKeyPairSync } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

const { authEnvMock } = vi.hoisted(() => ({
  authEnvMock: { INTERNAL_JWT_EXPIRATION: '30s', JWKS_KEY: '' },
}));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));

const { signHeteroOperationJWT, validateHeteroOperationJWT } = await import('./internalJwt');

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  authEnvMock.JWKS_KEY = JSON.stringify({
    keys: [{ ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'k1', use: 'sig' }],
  });
});

describe('hetero operation JWT requester', () => {
  it('carries the requester and the scm credential capability through validation', async () => {
    const token = await signHeteroOperationJWT({
      capabilities: ['hetero:ingest', 'scm:github-credential'],
      operationId: 'op-1',
      requesterUserId: 'user-visitor',
      userId: 'user-owner',
      workspaceId: 'ws-1',
    });

    const claims = await validateHeteroOperationJWT(token);

    expect(claims).toMatchObject({
      capabilities: ['hetero:ingest', 'scm:github-credential'],
      operation_id: 'op-1',
      requester: 'user-visitor',
      sub: 'user-owner',
    });
  });

  it('carries the device the token was issued for', async () => {
    const token = await signHeteroOperationJWT({
      capabilities: ['scm:github-credential'],
      deviceId: 'device-jp-1',
      operationId: 'op-1',
      userId: 'user-owner',
    });

    await expect(validateHeteroOperationJWT(token)).resolves.toMatchObject({
      device_id: 'device-jp-1',
    });
  });

  it('omits the requester claim when none is given', async () => {
    const token = await signHeteroOperationJWT({
      capabilities: ['hetero:ingest'],
      operationId: 'op-1',
      userId: 'user-owner',
    });

    const claims = await validateHeteroOperationJWT(token);

    expect(claims).not.toBeNull();
    expect(claims).not.toHaveProperty('requester');
  });

  it('signs a short-lived token when an expiration is given', async () => {
    const token = await signHeteroOperationJWT({
      capabilities: ['scm:github-credential'],
      expiration: '5m',
      operationId: 'op-1',
      requesterUserId: 'user-owner',
      userId: 'user-owner',
    });

    const claims = await validateHeteroOperationJWT(token);

    expect(claims!.exp - claims!.iat).toBe(300);
  });

  it('rejects a requester claim that is not a string', async () => {
    const { SignJWT } = await import('jose');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    authEnvMock.JWKS_KEY = JSON.stringify({
      keys: [{ ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'k2', use: 'sig' }],
    });
    const forged = await new SignJWT({
      capabilities: ['scm:github-credential'],
      operation_id: 'op-1',
      purpose: 'hetero-operation',
      requester: 42,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k2' })
      .setIssuer('urn:lobehub:internal')
      .setAudience('urn:lobehub:hetero-operation')
      .setSubject('user-owner')
      .setJti('jti')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(validateHeteroOperationJWT(forged)).resolves.toBeNull();
  });
});
