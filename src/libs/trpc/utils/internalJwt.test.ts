import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    JWKS_KEY: JSON.stringify({
      keys: [
        {
          alg: 'RS256',
          e: 'AQAB',
          kid: 'test-kid',
          kty: 'RSA',
          n: 'test-modulus',
          use: 'sig',
        },
      ],
    }),
    INTERNAL_JWT_EXPIRATION: '30s',
  },
}));

// Track SignJWT constructor payload and chain calls
let capturedPayload: Record<string, unknown> | undefined;
let capturedProtectedHeader: Record<string, unknown> | undefined;
let capturedSubject: string | undefined;
let capturedExpirationTime: string | undefined;

const signMock = vi.fn().mockResolvedValue('signed-jwt-token');

const SignJWT = vi.fn(function (this: Record<string, unknown>, payload: Record<string, unknown>) {
  capturedPayload = payload;
  this.setProtectedHeader = vi.fn(function (
    this: Record<string, unknown>,
    header: Record<string, unknown>,
  ) {
    capturedProtectedHeader = header;
    return this;
  });
  this.setSubject = vi.fn(function (this: Record<string, unknown>, sub: string) {
    capturedSubject = sub;
    return this;
  });
  this.setIssuedAt = vi.fn(function (this: Record<string, unknown>) {
    return this;
  });
  this.setExpirationTime = vi.fn(function (this: Record<string, unknown>, exp: string) {
    capturedExpirationTime = exp;
    return this;
  });
  this.sign = signMock;
  return this;
});

const importJWKMock = vi.fn().mockResolvedValue('mock-crypto-key');

vi.mock('jose', () => ({
  importJWK: (...args: unknown[]) => importJWKMock(...args),
  SignJWT,
}));

// Dynamically import the module under test after mocks are set up
const loadModule = async () => {
  return await import('./internalJwt');
};

describe('signUserJWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPayload = undefined;
    capturedProtectedHeader = undefined;
    capturedSubject = undefined;
    capturedExpirationTime = undefined;
  });

  it('should produce a JWT with 5-minute expiry', async () => {
    const { signUserJWT } = await loadModule();

    const token = await signUserJWT('user-123');

    expect(token).toBe('signed-jwt-token');
    expect(capturedExpirationTime).toBe('5m');
    expect(capturedSubject).toBe('user-123');
    expect(capturedPayload).toEqual({ purpose: 'cli-sandbox' });
    expect(capturedProtectedHeader).toEqual({ alg: 'RS256', kid: 'test-kid' });
    expect(signMock).toHaveBeenCalledWith('mock-crypto-key');
  });

  it('should set the purpose to cli-sandbox', async () => {
    const { signUserJWT } = await loadModule();

    await signUserJWT('user-abc');

    expect(capturedPayload).toEqual({ purpose: 'cli-sandbox' });
  });

  it('should pass the userId as the subject claim', async () => {
    const { signUserJWT } = await loadModule();

    await signUserJWT('specific-user-id');

    expect(capturedSubject).toBe('specific-user-id');
  });

  it('should import the JWK as RS256', async () => {
    const { signUserJWT } = await loadModule();

    await signUserJWT('user-123');

    expect(importJWKMock).toHaveBeenCalled();
    const [firstArg, secondArg] = importJWKMock.mock.calls[0];
    expect(firstArg).toHaveProperty('alg', 'RS256');
    expect(firstArg).toHaveProperty('kty', 'RSA');
    expect(secondArg).toBe('RS256');
  });
});

describe('signOperationJwt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPayload = undefined;
    capturedProtectedHeader = undefined;
    capturedSubject = undefined;
    capturedExpirationTime = undefined;
  });

  it('should produce a JWT with 4-hour expiry', async () => {
    const { signOperationJwt } = await loadModule();

    const token = await signOperationJwt('user-456');

    expect(token).toBe('signed-jwt-token');
    expect(capturedExpirationTime).toBe('4h');
  });

  it('should set the purpose to hetero-operation', async () => {
    const { signOperationJwt } = await loadModule();

    await signOperationJwt('user-789');

    expect(capturedPayload).toEqual({ purpose: 'hetero-operation' });
  });

  it('should pass the userId as the subject claim', async () => {
    const { signOperationJwt } = await loadModule();

    await signOperationJwt('hetero-user');

    expect(capturedSubject).toBe('hetero-user');
  });

  it('should use RS256 algorithm with correct kid', async () => {
    const { signOperationJwt } = await loadModule();

    await signOperationJwt('user-abc');

    expect(capturedProtectedHeader).toEqual({ alg: 'RS256', kid: 'test-kid' });
  });

  it('should sign with the imported crypto key', async () => {
    const { signOperationJwt } = await loadModule();

    await signOperationJwt('user-xyz');

    expect(signMock).toHaveBeenCalledWith('mock-crypto-key');
  });
});

describe('expiry contrast between signUserJWT and signOperationJwt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPayload = undefined;
    capturedProtectedHeader = undefined;
    capturedSubject = undefined;
    capturedExpirationTime = undefined;
  });

  it('signUserJWT should expire in 5m, signOperationJwt in 4h', async () => {
    const { signUserJWT, signOperationJwt } = await loadModule();

    // Reset tracked state between calls
    await signUserJWT('user-1');
    const userJwtExpiry = capturedExpirationTime;

    await signOperationJwt('user-1');
    const operationJwtExpiry = capturedExpirationTime;

    expect(userJwtExpiry).toBe('5m');
    expect(operationJwtExpiry).toBe('4h');
  });

  it('signUserJWT purpose should be cli-sandbox, signOperationJwt purpose should be hetero-operation', async () => {
    const { signUserJWT, signOperationJwt } = await loadModule();

    await signUserJWT('user-2');
    const userPurpose = capturedPayload;

    await signOperationJwt('user-2');
    const operationPurpose = capturedPayload;

    expect(userPurpose).toEqual({ purpose: 'cli-sandbox' });
    expect(operationPurpose).toEqual({ purpose: 'hetero-operation' });
  });
});

describe('signInternalJWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPayload = undefined;
    capturedProtectedHeader = undefined;
    capturedSubject = undefined;
    capturedExpirationTime = undefined;
  });

  it('should use INTERNAL_JWT_EXPIRATION from env (30s default)', async () => {
    const { signInternalJWT } = await loadModule();

    await signInternalJWT();

    expect(capturedExpirationTime).toBe('30s');
  });

  it('should set purpose to lobe-internal-call', async () => {
    const { signInternalJWT } = await loadModule();

    await signInternalJWT();

    expect(capturedPayload).toEqual({ purpose: 'lobe-internal-call' });
  });

  it('should NOT set a subject (internal calls are userless)', async () => {
    const { signInternalJWT } = await loadModule();

    await signInternalJWT();

    expect(capturedSubject).toBeUndefined();
  });
});
