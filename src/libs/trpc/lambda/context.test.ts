import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiKeyModel } from '@/database/models/apiKey';

import { createContextInner, createLambdaContext } from './context';

const {
  mockExtractTraceContext,
  mockFindByKey,
  mockGetSession,
  mockUpdateLastUsed,
  mockValidateOIDCJWT,
} = vi.hoisted(() => ({
  mockExtractTraceContext: vi.fn(),
  mockFindByKey: vi.fn(),
  mockGetSession: vi.fn(),
  mockUpdateLastUsed: vi.fn(),
  mockValidateOIDCJWT: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/models/apiKey', () => ({
  ApiKeyModel: Object.assign(
    vi.fn().mockImplementation((_db: unknown, userId: string) => ({
      updateLastUsed: userId ? mockUpdateLastUsed : vi.fn(),
    })),
    {
      findByKey: mockFindByKey,
    },
  ),
}));

vi.mock('@/envs/auth', () => ({
  LOBE_CHAT_AUTH_HEADER: 'X-lobe-chat-auth',
  LOBE_CHAT_OIDC_AUTH_HEADER: 'Oidc-Auth',
  authEnv: {
    ENABLE_OIDC: true,
  },
}));

vi.mock('@/libs/observability/traceparent', () => ({
  extractTraceContext: mockExtractTraceContext,
}));

vi.mock('@/libs/oidc-provider/jwt', () => ({
  validateOIDCJWT: mockValidateOIDCJWT,
}));

vi.mock('@/utils/apiKey', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    isApiKeyExpired: vi.fn().mockReturnValue(false),
  };
});

describe('createContextInner', () => {
  it('should create context with default values when no params provided', async () => {
    const context = await createContextInner();

    expect(context).toMatchObject({
      authorizationHeader: undefined,
      marketAccessToken: undefined,
      oidcAuth: undefined,
      userAgent: undefined,
      userId: undefined,
    });
    expect(context.resHeaders).toBeInstanceOf(Headers);
  });

  it('should create context with userId', async () => {
    const context = await createContextInner({ userId: 'user-123' });

    expect(context.userId).toBe('user-123');
  });

  it('should create context with authorization header', async () => {
    const context = await createContextInner({
      authorizationHeader: 'Bearer token-abc',
    });

    expect(context.authorizationHeader).toBe('Bearer token-abc');
  });

  it('should create context with user agent', async () => {
    const context = await createContextInner({
      userAgent: 'Mozilla/5.0',
    });

    expect(context.userAgent).toBe('Mozilla/5.0');
  });

  it('should create context with market access token', async () => {
    const context = await createContextInner({
      marketAccessToken: 'mp-token-xyz',
    });

    expect(context.marketAccessToken).toBe('mp-token-xyz');
  });

  it('should create context with OIDC auth data', async () => {
    const oidcAuth = {
      sub: 'oidc-user-123',
      payload: { iss: 'https://issuer.com', aud: 'client-id' },
    };

    const context = await createContextInner({ oidcAuth });

    expect(context.oidcAuth).toEqual(oidcAuth);
  });

  it('should create context with all parameters combined', async () => {
    const params = {
      authorizationHeader: 'Bearer token',
      userId: 'user-123',
      userAgent: 'Test Agent',
      marketAccessToken: 'mp-token',
      oidcAuth: {
        sub: 'oidc-sub',
        payload: { data: 'test' },
      },
    };

    const context = await createContextInner(params);

    expect(context).toMatchObject({
      authorizationHeader: 'Bearer token',
      userId: 'user-123',
      userAgent: 'Test Agent',
      marketAccessToken: 'mp-token',
      oidcAuth: { sub: 'oidc-sub', payload: { data: 'test' } },
    });
  });

  it('should always include response headers', async () => {
    const context1 = await createContextInner();
    const context2 = await createContextInner({ userId: 'test' });

    expect(context1.resHeaders).toBeInstanceOf(Headers);
    expect(context2.resHeaders).toBeInstanceOf(Headers);
  });

  it('should always provide resHeaders', async () => {
    const ctx = await createContextInner();

    expect(ctx.resHeaders).toBeInstanceOf(Headers);
  });

  it('should keep provided traceContext', async () => {
    const traceContext = { test: 'ctx' } as any;
    const ctx = await createContextInner({ traceContext });

    expect(ctx.traceContext).toBe(traceContext);
  });
});

describe('createLambdaContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractTraceContext.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue({ user: { id: 'session-user' } });
    mockValidateOIDCJWT.mockResolvedValue({
      tokenData: { sub: 'oidc-user' },
      userId: 'oidc-user',
    });
    mockUpdateLastUsed.mockResolvedValue(undefined);
  });

  it('should authenticate with API key and skip session fallback', async () => {
    const apiKeyRecord = {
      accessedAt: new Date(),
      createdAt: new Date(),
      enabled: true,
      expiresAt: null,
      id: 'key-1',
      key: 'encrypted-key',
      keyHash: 'hashed-key',
      lastUsedAt: null,
      name: 'Test API Key',
      updatedAt: new Date(),
      userId: 'api-user',
    } satisfies NonNullable<Awaited<ReturnType<typeof ApiKeyModel.findByKey>>>;

    vi.mocked(ApiKeyModel.findByKey).mockResolvedValue(apiKeyRecord);

    const request = new NextRequest('https://example.com/trpc/lambda', {
      headers: {
        'X-API-Key': 'sk-lh-aaaaaaaaaaaaaaaa',
      },
    });

    const context = await createLambdaContext(request);

    expect(context.userId).toBe('api-user');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockValidateOIDCJWT).not.toHaveBeenCalled();
  });

  it('should reject invalid API key without falling back to OIDC or session', async () => {
    vi.mocked(ApiKeyModel.findByKey).mockResolvedValue(null);

    const request = new NextRequest('https://example.com/trpc/lambda', {
      headers: {
        'Oidc-Auth': 'oidc-token',
        'X-API-Key': 'sk-lh-bbbbbbbbbbbbbbbb',
      },
    });

    const context = await createLambdaContext(request);

    expect(context.userId).toBeNull();
    expect(mockValidateOIDCJWT).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('should use session auth when no API key header is present', async () => {
    const request = new NextRequest('https://example.com/trpc/lambda');

    const context = await createLambdaContext(request);

    expect(context.userId).toBe('session-user');
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});
