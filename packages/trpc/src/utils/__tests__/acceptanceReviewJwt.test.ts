import { exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Real keys, real signatures: the property under test is what the signed bytes
// can and cannot unlock, which a mocked `jose` cannot show.
const env = vi.hoisted(() => ({ INTERNAL_JWT_EXPIRATION: '30s', JWKS_KEY: '' }));
vi.mock('@/envs/auth', () => ({ authEnv: env }));

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  env.JWKS_KEY = JSON.stringify({ keys: [{ ...jwk, alg: 'RS256', kid: 'test-kid', use: 'sig' }] });
});

const session = {
  acceptanceId: '6f3c1a52-8d1e-4a6b-9a55-2a4f0c2d9e11',
  capabilities: ['comment', 'reject'] as const,
  origin: 'https://product.example.com',
  userId: 'user_reviewer',
};

describe('acceptance-review JWT', () => {
  it('round-trips the acceptance, origin and capabilities it was minted for', async () => {
    const { signAcceptanceReviewJWT, validateAcceptanceReviewJWT } = await import('../internalJwt');
    const token = await signAcceptanceReviewJWT({
      ...session,
      capabilities: [...session.capabilities],
    });

    await expect(validateAcceptanceReviewJWT(token)).resolves.toMatchObject({
      acceptance_id: session.acceptanceId,
      capabilities: ['comment', 'reject'],
      origin: session.origin,
      purpose: 'acceptance-review',
      sub: session.userId,
    });
  });

  it('is not a user session: the shared OIDC validator refuses it', async () => {
    const { signAcceptanceReviewJWT } = await import('../internalJwt');
    const { validateOIDCJWT } = await import('@/libs/oidc-provider/jwt');
    const token = await signAcceptanceReviewJWT({ ...session, capabilities: ['comment'] });

    await expect(validateOIDCJWT(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('does not accept another narrow token in its place', async () => {
    const { signHeteroOperationJWT, validateAcceptanceReviewJWT } = await import('../internalJwt');
    const hetero = await signHeteroOperationJWT({
      capabilities: ['hetero:ingest'],
      operationId: 'op_1',
      userId: session.userId,
    });

    await expect(validateAcceptanceReviewJWT(hetero)).resolves.toBeNull();
  });

  it('refuses an expired session', async () => {
    const { signAcceptanceReviewJWT, validateAcceptanceReviewJWT } = await import('../internalJwt');
    const token = await signAcceptanceReviewJWT({
      ...session,
      capabilities: ['comment'],
      expiration: '-1s',
    });

    await expect(validateAcceptanceReviewJWT(token)).resolves.toBeNull();
  });

  it('rejects claims with an unknown capability', async () => {
    const { validateAcceptanceReviewClaims } = await import('../internalJwt');
    const claims = {
      acceptance_id: session.acceptanceId,
      aud: 'urn:lobehub:acceptance-review',
      capabilities: ['comment', 'admin'],
      exp: 9_999_999_999,
      iss: 'urn:lobehub:internal',
      jti: 'j',
      origin: session.origin,
      purpose: 'acceptance-review',
      sub: session.userId,
    };

    expect(validateAcceptanceReviewClaims(claims)).toBeNull();
    expect(validateAcceptanceReviewClaims({ ...claims, capabilities: ['comment'] })).not.toBeNull();
  });
});
