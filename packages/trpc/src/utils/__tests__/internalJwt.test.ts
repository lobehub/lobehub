import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must mock authEnv before importing the module under test so getJwksKey() resolves.
vi.mock('@/envs/auth', () => ({
  authEnv: {
    INTERNAL_JWT_EXPIRATION: '30s',
    JWKS_KEY: JSON.stringify({
      keys: [
        {
          alg: 'RS256',
          d: 'private-d',
          dp: 'private-dp',
          dq: 'private-dq',
          e: 'AQAB',
          kid: 'test-kid',
          kty: 'RSA',
          n: 'test-modulus',
          p: 'private-p',
          q: 'private-q',
          qi: 'private-qi',
          use: 'sig',
        },
      ],
    }),
  },
}));

// Mock jose so we never need real RSA keys.
// SignJWT is a class with a fluent builder API — every setter must return `this`
// so the chain (.setProtectedHeader().setSubject()…) doesn't break.
const signMock = vi.fn().mockResolvedValue('signed.jwt.token');
const setExpirationTimeMock = vi.fn();
const setAudienceMock = vi.fn();
const setIssuerMock = vi.fn();
const setIssuedAtMock = vi.fn();
const setJtiMock = vi.fn();
const setSubjectMock = vi.fn();
const setProtectedHeaderMock = vi.fn();

const buildSignJWTChain = () => {
  const chain = {
    setAudience: setAudienceMock.mockReturnValue(undefined as any),
    setExpirationTime: setExpirationTimeMock.mockReturnValue(undefined as any),
    setIssuer: setIssuerMock.mockReturnValue(undefined as any),
    setIssuedAt: setIssuedAtMock.mockReturnValue(undefined as any),
    setJti: setJtiMock.mockReturnValue(undefined as any),
    setProtectedHeader: setProtectedHeaderMock.mockReturnValue(undefined as any),
    setSubject: setSubjectMock.mockReturnValue(undefined as any),
    sign: signMock,
  };
  // Make every setter return the same chain object so .method().method() works.
  setProtectedHeaderMock.mockReturnValue(chain);
  setAudienceMock.mockReturnValue(chain);
  setIssuerMock.mockReturnValue(chain);
  setJtiMock.mockReturnValue(chain);
  setSubjectMock.mockReturnValue(chain);
  setIssuedAtMock.mockReturnValue(chain);
  setExpirationTimeMock.mockReturnValue(chain);
  return chain;
};

const SignJWTMock = vi.fn();
const importJWKMock = vi.fn().mockResolvedValue('mock-crypto-key');

vi.mock('jose', () => ({
  SignJWT: SignJWTMock,
  importJWK: (...args: unknown[]) => importJWKMock(...args),
  jwtVerify: vi.fn(),
}));

describe('internalJwt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importJWKMock.mockResolvedValue('mock-crypto-key');
    signMock.mockResolvedValue('signed.jwt.token');
    SignJWTMock.mockImplementation(() => buildSignJWTChain());
  });

  describe('signUserJWT', () => {
    it('signs a JWT with 5-minute expiry and cli-sandbox purpose', async () => {
      const { signUserJWT } = await import('../internalJwt');

      const token = await signUserJWT('user-123');

      expect(token).toBe('signed.jwt.token');
      expect(SignJWTMock).toHaveBeenCalledWith({ purpose: 'cli-sandbox' });
      expect(setSubjectMock).toHaveBeenCalledWith('user-123');
      expect(setExpirationTimeMock).toHaveBeenCalledWith('5m');
      expect(signMock).toHaveBeenCalledWith('mock-crypto-key');
    });

    it('sets the protected header with RS256 and the key id', async () => {
      const { signUserJWT } = await import('../internalJwt');

      await signUserJWT('user-abc');

      expect(setProtectedHeaderMock).toHaveBeenCalledWith({ alg: 'RS256', kid: 'test-kid' });
    });

    it('calls setIssuedAt to stamp the creation time', async () => {
      const { signUserJWT } = await import('../internalJwt');

      await signUserJWT('user-abc');

      expect(setIssuedAtMock).toHaveBeenCalled();
    });

    it('honors an explicit run-length expiration (e.g. a hetero sandbox run)', async () => {
      const { signUserJWT } = await import('../internalJwt');

      await signUserJWT('user-abc', '4h');

      expect(setExpirationTimeMock).toHaveBeenCalledWith('4h');
      // Still a user-scoped token, just longer-lived.
      expect(SignJWTMock).toHaveBeenCalledWith({ purpose: 'cli-sandbox' });
    });
  });

  describe('signOperationJwt', () => {
    it('binds a server model selection into the operation token', async () => {
      const { signHeteroOperationJWT } = await import('../internalJwt');

      await signHeteroOperationJWT({
        capabilities: ['model:invoke'],
        model: 'gpt-server',
        operationId: 'op-server',
        providerId: 'openai',
        userId: 'user-456',
      });

      expect(SignJWTMock).toHaveBeenCalledWith({
        capabilities: ['model:invoke'],
        model: 'gpt-server',
        operation_id: 'op-server',
        provider_id: 'openai',
        purpose: 'hetero-operation',
      });
    });

    it('signs a JWT with 4-hour expiry and hetero-operation purpose', async () => {
      const { signOperationJwt } = await import('../internalJwt');

      const token = await signOperationJwt('user-456', 'op-123');

      expect(token).toBe('signed.jwt.token');
      expect(SignJWTMock).toHaveBeenCalledWith({
        capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
        operation_id: 'op-123',
        purpose: 'hetero-operation',
      });
      expect(setAudienceMock).toHaveBeenCalledWith('urn:lobehub:hetero-operation');
      expect(setIssuerMock).toHaveBeenCalledWith('urn:lobehub:internal');
      expect(setJtiMock).toHaveBeenCalled();
      expect(setSubjectMock).toHaveBeenCalledWith('user-456');
      expect(setExpirationTimeMock).toHaveBeenCalledWith('4h');
      expect(signMock).toHaveBeenCalledWith('mock-crypto-key');
    });

    it('binds a workspace operation token to the durable workspace principal', async () => {
      const { signOperationJwt } = await import('../internalJwt');

      await signOperationJwt('user-456', 'op-workspace', 'workspace-123');

      expect(SignJWTMock).toHaveBeenCalledWith({
        capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
        operation_id: 'op-workspace',
        purpose: 'hetero-operation',
        workspace_id: 'workspace-123',
      });
    });

    it('sets the protected header with RS256 and the key id', async () => {
      const { signOperationJwt } = await import('../internalJwt');

      await signOperationJwt('user-456', 'op-header');

      expect(setProtectedHeaderMock).toHaveBeenCalledWith({ alg: 'RS256', kid: 'test-kid' });
    });

    it('calls setIssuedAt to stamp the creation time', async () => {
      const { signOperationJwt } = await import('../internalJwt');

      await signOperationJwt('user-456', 'op-issued-at');

      expect(setIssuedAtMock).toHaveBeenCalled();
    });

    it('uses a longer expiry than signUserJWT (4h vs 5m)', async () => {
      const { signOperationJwt, signUserJWT } = await import('../internalJwt');

      await signUserJWT('user-a');
      const userExpiry = setExpirationTimeMock.mock.calls.at(-1)?.[0];

      await signOperationJwt('user-b', 'op-expiry');
      const opExpiry = setExpirationTimeMock.mock.calls.at(-1)?.[0];

      expect(userExpiry).toBe('5m');
      expect(opExpiry).toBe('4h');
    });
  });

  describe('validateHeteroOperationClaims', () => {
    const validClaims = {
      aud: 'urn:lobehub:hetero-operation',
      capabilities: ['model:invoke'],
      exp: 2,
      iat: 1,
      iss: 'urn:lobehub:internal',
      jti: 'jti-1',
      operation_id: 'op-1',
      purpose: 'hetero-operation',
      sub: 'user-1',
    };

    it('accepts the typed operation contract', async () => {
      const { validateHeteroOperationClaims } = await import('../internalJwt');
      expect(validateHeteroOperationClaims(validClaims)).toEqual(validClaims);
    });

    it.each(['aud', 'iss', 'purpose', 'operation_id', 'capabilities'])(
      'rejects invalid %s',
      async (field) => {
        const { validateHeteroOperationClaims } = await import('../internalJwt');
        expect(validateHeteroOperationClaims({ ...validClaims, [field]: undefined })).toBeNull();
      },
    );
  });

  describe('signInternalJWT', () => {
    it('signs a JWT with the internal purpose from env expiry', async () => {
      const { signInternalJWT } = await import('../internalJwt');

      const token = await signInternalJWT();

      expect(token).toBe('signed.jwt.token');
      expect(SignJWTMock).toHaveBeenCalledWith({ purpose: 'lobe-internal-call' });
      expect(setExpirationTimeMock).toHaveBeenCalledWith('30s');
    });
  });
});
