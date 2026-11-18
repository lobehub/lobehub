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
const createLocalJWKSetMock = vi.fn();
const decodeProtectedHeaderMock = vi.fn();
const jwtVerifyMock = vi.fn();

vi.mock('jose', () => ({
  createLocalJWKSet: (...args: unknown[]) => createLocalJWKSetMock(...args),
  decodeProtectedHeader: (...args: unknown[]) => decodeProtectedHeaderMock(...args),
  importJWK: (...args: unknown[]) => importJWKMock(...args),
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
}));

describe('validateOIDCJWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLocalJWKSetMock.mockReturnValue('public-key-set');
    decodeProtectedHeaderMock.mockReturnValue({ kid: 'test-key' });
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
    createLocalJWKSetMock.mockReturnValue('public-key-set');
    decodeProtectedHeaderMock.mockReturnValue({ kid: 'test-key' });
    importJWKMock.mockResolvedValue('public-key');
  });

  it('are refused as an app session', async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: REVIEW_AUD, client_id: 'lobehub-acceptance', sub: 'user-1' },
    });
    const { validateOIDCJWT } = await import('./jwt');
    await expect(validateOIDCJWT('t')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuse anything else the review client was issued, such as its ID token', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    jwtVerifyMock.mockResolvedValueOnce({ payload: { aud: 'lobehub-acceptance', sub: 'user-1' } });
    await expect(validateOIDCJWT('t')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: ['urn:lobehub:chat'], client_id: 'lobehub-acceptance', sub: 'user-1' },
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
      payload: {
        aud: REVIEW_AUD,
        client_id: 'lobehub-acceptance',
        exp: 1_800_000_000,
        sub: 'user-1',
      },
    });
    const { verifyAcceptanceReviewJWT } = await import('./jwt');
    await expect(verifyAcceptanceReviewJWT('t')).resolves.toEqual({
      acceptanceId: '7f0c9a7e-0000-4000-8000-000000000001',
      clientId: 'lobehub-acceptance',
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

describe('scoped OAuth tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLocalJWKSetMock.mockReturnValue('public-key-set');
    decodeProtectedHeaderMock.mockReturnValue({ kid: 'test-key' });
    importJWKMock.mockResolvedValue('public-key');
  });

  const verifyAs = (payload: Record<string, unknown>) =>
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { aud: 'urn:lobehub:chat', sub: 'user-1', ...payload },
    });

  // The consent page promised only these scopes; a transport that does not
  // enforce them would hand the app the whole account.
  it.each([
    ['a token carrying an API scope', { client_id: 'lca_app', scope: 'openid agent:read' }],
    ['any token of a dynamically registered client', { client_id: 'lcd_app', scope: 'openid' }],
  ])('refuses %s unless the caller enforces scopes', async (_label, payload) => {
    const { validateOIDCJWT } = await import('./jwt');

    verifyAs(payload);
    await expect(validateOIDCJWT('header.payload.signature')).rejects.toThrow(
      /only accepted by the public API/,
    );

    verifyAs(payload);
    await expect(
      validateOIDCJWT('header.payload.signature', { allowScopedTokens: true }),
    ).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('keeps first-party sign-ins without API scopes working everywhere', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    verifyAs({ client_id: 'lobehub-desktop', scope: 'openid profile offline_access' });

    await expect(validateOIDCJWT('header.payload.signature')).resolves.toMatchObject({
      userId: 'user-1',
    });
  });

  it('acts as the owner of a client_credentials token only where allowed', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    const machine = { client_id: 'lcd_app', lobehub_owner: 'owner-1', sub: 'lcd_app' };

    verifyAs(machine);
    await expect(validateOIDCJWT('header.payload.signature')).rejects.toThrow(
      /only accepted by the public API/,
    );

    verifyAs(machine);
    await expect(
      validateOIDCJWT('header.payload.signature', { allowClientCredentials: true }),
    ).resolves.toMatchObject({ tokenData: { clientCredentials: true }, userId: 'owner-1' });
  });

  it('refuses a client-subject token that names no owner', async () => {
    const { validateOIDCJWT } = await import('./jwt');
    verifyAs({ client_id: 'lcd_app', sub: 'lcd_app' });

    await expect(
      validateOIDCJWT('header.payload.signature', { allowClientCredentials: true }),
    ).rejects.toThrow(/without an owner/);
  });
});
