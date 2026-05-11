import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuth, userAuthMiddleware } from './auth';

interface TestHonoEnv {
  Variables: {
    authData: unknown;
    authorizationHeader: string | null;
    authType: string | null;
    userId: string | null;
  };
}

const {
  mockAssertOIDCUserActive,
  mockAuthEnv,
  mockGetServerDB,
  mockExtractBearerToken,
  mockServerDB,
  mockValidateApiKeyFormat,
  mockValidateOIDCJWT,
} = vi.hoisted(() => ({
  mockAssertOIDCUserActive: vi.fn(),
  mockAuthEnv: { ENABLE_OIDC: true },
  mockExtractBearerToken: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockServerDB: {},
  mockValidateApiKeyFormat: vi.fn(),
  mockValidateOIDCJWT: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/apiKey', () => ({
  ApiKeyModel: class {},
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mockAuthEnv,
}));

vi.mock('@/libs/oidc-provider/access-control', () => ({
  assertOIDCUserActive: mockAssertOIDCUserActive,
}));

vi.mock('@/libs/oidc-provider/jwt', () => ({
  validateOIDCJWT: mockValidateOIDCJWT,
}));

vi.mock('@/utils/apiKey', () => ({
  validateApiKeyFormat: mockValidateApiKeyFormat,
}));

vi.mock('@/utils/server/auth', () => ({
  extractBearerToken: mockExtractBearerToken,
}));

const createApp = () => {
  const app = new Hono<TestHonoEnv>();

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();

    return c.text(error.message, 500);
  });

  app.use('*', userAuthMiddleware);
  app.get('/protected', requireAuth, (c) =>
    c.json({
      authType: c.get('authType'),
      userId: c.get('userId'),
    }),
  );

  return app;
};

describe('OpenAPI auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthEnv.ENABLE_OIDC = true;
    mockExtractBearerToken.mockReturnValue('oidc-token');
    mockGetServerDB.mockResolvedValue(mockServerDB);
    mockValidateApiKeyFormat.mockReturnValue(false);
    mockValidateOIDCJWT.mockResolvedValue({
      tokenData: { sub: 'oidc-user' },
      userId: 'oidc-user',
    });
    mockAssertOIDCUserActive.mockResolvedValue(undefined);
  });

  it('should authenticate an active OIDC bearer token', async () => {
    const app = createApp();

    const response = await app.request('/protected', {
      headers: { Authorization: 'Bearer oidc-token' },
    });

    await expect(response.json()).resolves.toEqual({
      authType: 'oidc',
      userId: 'oidc-user',
    });
    expect(response.status).toBe(200);
    expect(mockValidateOIDCJWT).toHaveBeenCalledWith('oidc-token');
    expect(mockAssertOIDCUserActive).toHaveBeenCalledWith(mockServerDB, 'oidc-user');
  });

  it('should reject an inactive OIDC bearer token without authenticating the request', async () => {
    const app = createApp();
    const inactiveError = Object.assign(new Error('OIDC user is no longer active'), {
      code: 'UNAUTHORIZED',
    });
    mockValidateOIDCJWT.mockResolvedValueOnce({
      tokenData: { sub: 'banned-user' },
      userId: 'banned-user',
    });
    mockAssertOIDCUserActive.mockRejectedValueOnce(inactiveError);

    const response = await app.request('/protected', {
      headers: { Authorization: 'Bearer oidc-token' },
    });

    expect(response.status).toBe(401);
    expect(mockAssertOIDCUserActive).toHaveBeenCalledWith(mockServerDB, 'banned-user');
  });
});
