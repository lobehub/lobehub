import { generateKeyPairSync } from 'node:crypto';

import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { authEnvMock } = vi.hoisted(() => ({ authEnvMock: { JWKS_KEY: '' } }));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateJwk = { ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'k1', use: 'sig' };

const SITE = 'urn:lobehub:site:psite_7f3k9q2mAbCd:https%3A%2F%2Ffieldnotes.app';

const sign = (claims: Record<string, unknown>, aud: string) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setAudience(aud)
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

beforeAll(() => {
  authEnvMock.JWKS_KEY = JSON.stringify({ keys: [privateJwk] });
});

describe('extension-issued review tokens', () => {
  it('are minted for one site and read back as an extension-client review token', async () => {
    const { signAcceptanceReviewToken, verifyAcceptanceReviewJWT } = await import('./jwt');
    const now = Math.floor(Date.now() / 1000);

    const { expiresAt, token } = await signAcceptanceReviewToken({
      resource: SITE,
      userId: 'user-1',
    });
    const claims = await verifyAcceptanceReviewJWT(token);

    expect(claims).toMatchObject({
      clientId: 'lobehub-acceptance-extension',
      site: { origin: 'https://fieldnotes.app', siteId: 'psite_7f3k9q2mAbCd' },
      userId: 'user-1',
    });
    expect(claims.expiresAt).toBe(expiresAt);
    expect(expiresAt - now).toBeGreaterThanOrEqual(8 * 60 * 60 - 5);
    expect(expiresAt - now).toBeLessThanOrEqual(8 * 60 * 60 + 5);
  });

  it('report the page client for tokens the toolbar signed in for itself', async () => {
    const { verifyAcceptanceReviewJWT } = await import('./jwt');
    const token = await sign({ client_id: 'lobehub-acceptance' }, SITE);

    expect((await verifyAcceptanceReviewJWT(token)).clientId).toBe('lobehub-acceptance');
  });

  it('are refused as an app session', async () => {
    const { signAcceptanceReviewToken, validateOIDCJWT } = await import('./jwt');
    const { token } = await signAcceptanceReviewToken({ resource: SITE, userId: 'user-1' });

    await expect(validateOIDCJWT(token)).rejects.toThrow('not accepted');
  });
});

describe('origin-bound acceptance tokens', () => {
  it('read back the preview origin they were issued for', async () => {
    const { verifyAcceptanceReviewJWT } = await import('./jwt');
    const id = '7f0c9a7e-0000-4000-8000-000000000001';
    const token = await sign(
      { client_id: 'lobehub-acceptance' },
      `urn:lobehub:acceptance:${id}:https%3A%2F%2Fpr-12.preview.app`,
    );

    expect(await verifyAcceptanceReviewJWT(token)).toMatchObject({
      acceptanceId: id,
      acceptanceOrigin: 'https://pr-12.preview.app',
    });
  });
});

describe('extension access tokens', () => {
  const AUDIENCE = 'urn:lobehub:acceptance-extension';

  it('are accepted for the extension audience and client', async () => {
    const { verifyAcceptanceExtensionJWT } = await import('./jwt');
    const token = await sign({ client_id: 'lobehub-acceptance-extension' }, AUDIENCE);

    await expect(verifyAcceptanceExtensionJWT(token)).resolves.toEqual({ userId: 'user-1' });
  });

  it('reject review tokens, app tokens and other clients', async () => {
    const { verifyAcceptanceExtensionJWT } = await import('./jwt');

    for (const token of [
      await sign({ client_id: 'lobehub-acceptance-extension' }, SITE),
      await sign({ client_id: 'lobehub-desktop' }, 'urn:lobehub:chat'),
      await sign({ client_id: 'lobehub-desktop' }, AUDIENCE),
    ]) {
      await expect(verifyAcceptanceExtensionJWT(token)).rejects.toThrow();
    }
  });

  it('are refused as an app session', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const token = await sign({ client_id: 'lobehub-acceptance-extension' }, AUDIENCE);

    await expect(validateOIDCJWT(token)).rejects.toThrow('not accepted');
  });
});
