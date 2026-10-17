import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    JWKS_KEY: JSON.stringify({
      keys: [
        {
          alg: 'RS256',
          e: 'AQAB',
          kid: 'test-key',
          kty: 'RSA',
          n: 'test-modulus',
          use: 'sig',
        },
      ],
    }),
  },
}));

const importJWKMock = vi.fn();
const jwtVerifyMock = vi.fn();

vi.mock('jose', () => ({
  importJWK: (...args: unknown[]) => importJWKMock(...args),
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
}));

describe('validateOIDCJWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importJWKMock.mockResolvedValue('public-key');
  });

  it('should preserve the original jose error as TRPCError cause', async () => {
    const joseError = Object.assign(new Error('"exp" claim timestamp check failed'), {
      code: 'ERR_JWT_EXPIRED',
    });
    jwtVerifyMock.mockRejectedValueOnce(joseError);

    const { validateOIDCJWT } = await import('./jwt');

    await expect(validateOIDCJWT('header.payload.signature')).rejects.toMatchObject({
      cause: joseError,
      code: 'UNAUTHORIZED',
    });
  });

  it('should not wrap JWKS/public key retrieval failures as TRPCError', async () => {
    importJWKMock.mockRejectedValueOnce(new Error('invalid JWK'));

    const { validateOIDCJWT } = await import('./jwt');

    const error = await validateOIDCJWT('header.payload.signature').catch((error_) => error_);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TRPCError);
    expect((error as Error).message).toBe('JWKS_KEY public key retrieval failed: invalid JWK');
  });
});

describe('acceptance review tokens', () => {
  const REVIEW_AUD = 'urn:lobehub:acceptance:7f0c9a7e-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    importJWKMock.mockResolvedValue('public-key');
  });

  it('are refused as an app session', async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: REVIEW_AUD, client_id: 'lobehub-review', sub: 'user-1' },
    });
    const { validateOIDCJWT } = await import('./jwt');
    await expect(validateOIDCJWT('t')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuse anything else the review client was issued, such as its ID token', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    jwtVerifyMock.mockResolvedValueOnce({ payload: { aud: 'lobehub-review', sub: 'user-1' } });
    await expect(validateOIDCJWT('t')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: ['urn:lobehub:chat'], client_id: 'lobehub-review', sub: 'user-1' },
    });
    await expect(validateOIDCJWT('t')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('do not affect tokens for the app API', async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: 'urn:lobehub:chat', client_id: 'lobehub-desktop', sub: 'user-1' },
    });
    const { validateOIDCJWT } = await import('./jwt');
    await expect(validateOIDCJWT('t')).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('are read back as the acceptance and user they were issued for', async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: REVIEW_AUD, client_id: 'lobehub-review', exp: 1_800_000_000, sub: 'user-1' },
    });
    const { verifyAcceptanceReviewJWT } = await import('./jwt');
    await expect(verifyAcceptanceReviewJWT('t')).resolves.toEqual({
      acceptanceId: '7f0c9a7e-0000-4000-8000-000000000001',
      expiresAt: 1_800_000_000,
      userId: 'user-1',
    });
  });

  it('reject any other token as a review token', async () => {
    const { verifyAcceptanceReviewJWT } = await import('./jwt');
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: 'urn:lobehub:chat', client_id: 'lobehub-desktop', sub: 'user-1' },
    });
    await expect(verifyAcceptanceReviewJWT('t')).rejects.toThrow();
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: REVIEW_AUD, client_id: 'lobehub-cli', sub: 'user-1' },
    });
    await expect(verifyAcceptanceReviewJWT('t')).rejects.toThrow();
  });
});
