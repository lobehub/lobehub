import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createErrorResponse } from '@/utils/errorResponse';

import { checkAuth, type RequestHandler } from './index';
import { checkAuthMethod } from './utils';

vi.mock('@lobechat/model-runtime', () => ({
  AgentRuntimeError: {
    createError: vi.fn((type: string) => ({ errorType: type })),
  },
}));

vi.mock('@lobechat/types', () => ({
  ChatErrorType: { Unauthorized: 'Unauthorized', InternalServerError: 'InternalServerError' },
}));

vi.mock('@/utils/errorResponse', () => ({
  createErrorResponse: vi.fn(),
}));

vi.mock('./utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/libs/observability/traceparent', () => ({
  extractTraceContext: vi.fn(),
  injectActiveTraceHeaders: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/api', () => ({
  context: { with: vi.fn((_ctx: any, fn: () => any) => fn()) },
}));

vi.mock('@/libs/oidc-provider/jwt', () => ({
  validateOIDCJWT: vi.fn(),
}));

vi.mock('@/envs/auth', () => ({
  LOBE_CHAT_OIDC_AUTH_HEADER: 'Oidc-Auth',
}));

describe('checkAuth', () => {
  const mockHandler: RequestHandler = vi.fn();
  const mockRequest = new Request('https://example.com');
  const mockOptions = { params: Promise.resolve({ provider: 'mock' }) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it('should return error response on checkAuthMethod error (no session)', async () => {
    const mockError = AgentRuntimeError.createError(ChatErrorType.Unauthorized);
    vi.mocked(checkAuthMethod).mockImplementationOnce(() => {
      throw mockError;
    });

    await checkAuth(mockHandler)(mockRequest, mockOptions);

    expect(createErrorResponse).toHaveBeenCalledWith(ChatErrorType.Unauthorized, {
      error: mockError,
      provider: 'mock',
    });
    expect(mockHandler).not.toHaveBeenCalled();
  });

  describe('mock dev user', () => {
    it('should use MOCK_DEV_USER_ID when ENABLE_MOCK_DEV_USER is enabled', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
      vi.stubEnv('MOCK_DEV_USER_ID', 'mock-user-123');

      await checkAuth(mockHandler)(mockRequest, mockOptions);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.any(Request),
        expect.objectContaining({
          jwtPayload: { userId: 'mock-user-123' },
          userId: 'mock-user-123',
        }),
      );
    });

    it('should fall back to DEV_USER when MOCK_DEV_USER_ID is not set', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
      delete process.env.MOCK_DEV_USER_ID;

      await checkAuth(mockHandler)(mockRequest, mockOptions);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.any(Request),
        expect.objectContaining({
          jwtPayload: { userId: 'DEV_USER' },
          userId: 'DEV_USER',
        }),
      );
    });

    it('should use MOCK_DEV_USER_ID with debug header', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('MOCK_DEV_USER_ID', 'mock-user-456');

      const debugRequest = new Request('https://example.com', {
        headers: { 'lobe-auth-dev-backend-api': '1' },
      });

      await checkAuth(mockHandler)(debugRequest, mockOptions);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.any(Request),
        expect.objectContaining({
          jwtPayload: { userId: 'mock-user-456' },
          userId: 'mock-user-456',
        }),
      );
    });

    it('should not mock user in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
      vi.stubEnv('MOCK_DEV_USER_ID', 'mock-user-123');

      await checkAuth(mockHandler)(mockRequest, mockOptions);

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });
});
