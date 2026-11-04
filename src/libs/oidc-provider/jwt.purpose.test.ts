import { generateKeyPairSync } from 'node:crypto';

import { MANAGED_DEVICE_JWT_PURPOSE } from '@lobechat/types';
import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { authEnvMock } = vi.hoisted(() => ({
  authEnvMock: { INTERNAL_JWT_EXPIRATION: '30s', JWKS_KEY: '' },
}));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'test-key';

const sign = (claims: Record<string, unknown>, subject: string) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

describe('validateOIDCJWT token purposes', () => {
  beforeAll(() => {
    authEnvMock.JWKS_KEY = JSON.stringify({
      keys: [{ ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid, use: 'sig' }],
    });
  });

  it('rejects a personal managed device token as a login', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const token = await sign(
      { device_id: 'managed-device-1', purpose: MANAGED_DEVICE_JWT_PURPOSE },
      'user-1',
    );

    await expect(validateOIDCJWT(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a workspace managed device token as a login', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const token = await sign(
      {
        device_id: 'managed-device-1',
        purpose: MANAGED_DEVICE_JWT_PURPOSE,
        workspace_id: 'workspace-1',
      },
      'workspace-1',
    );

    await expect(validateOIDCJWT(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects the other device gateway tokens as a login', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const { signTunnelAccessToken, signWorkspaceDeviceToken } =
      await import('@/libs/trpc/utils/internalJwt');

    await expect(
      validateOIDCJWT(await signTunnelAccessToken({ userId: 'user-1' })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      validateOIDCJWT(await signWorkspaceDeviceToken('workspace-1')),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('still accepts an OIDC access token', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const token = await sign({ client_id: 'lobehub-desktop', scope: 'openid' }, 'user-1');

    await expect(validateOIDCJWT(token)).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('still accepts the sandbox CLI token and the hetero operation token', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const { signHeteroOperationJWT, signUserJWT } = await import('@/libs/trpc/utils/internalJwt');

    await expect(validateOIDCJWT(await signUserJWT('user-1'))).resolves.toMatchObject({
      tokenData: { purpose: 'cli-sandbox' },
      userId: 'user-1',
    });
    await expect(
      validateOIDCJWT(
        await signHeteroOperationJWT({
          capabilities: ['hetero:ingest'],
          operationId: 'operation-1',
          userId: 'user-1',
        }),
      ),
    ).resolves.toMatchObject({ tokenData: { purpose: 'hetero-operation' }, userId: 'user-1' });
  });
});
