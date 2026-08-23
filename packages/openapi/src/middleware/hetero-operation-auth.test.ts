import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireHeteroModelInvocation } from './hetero-operation-auth';

const {
  mockExtractBearerToken,
  mockGetServerDB,
  mockResolveActiveHeteroOperationPrincipal,
  mockValidateHeteroOperationJWT,
} = vi.hoisted(() => ({
  mockExtractBearerToken: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockResolveActiveHeteroOperationPrincipal: vi.fn(),
  mockValidateHeteroOperationJWT: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mockGetServerDB }));
vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  validateHeteroOperationJWT: mockValidateHeteroOperationJWT,
}));
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', () => ({
  HeteroOperationPrincipalError: class extends Error {},
  resolveActiveHeteroOperationPrincipal: mockResolveActiveHeteroOperationPrincipal,
}));
vi.mock('@/utils/server/auth', () => ({ extractBearerToken: mockExtractBearerToken }));

const createApp = () => {
  const app = new Hono();
  app.onError((error) =>
    error instanceof HTTPException ? error.getResponse() : new Response(null, { status: 500 }),
  );
  app.use('*', requireHeteroModelInvocation);
  app.get('/invoke', (c) =>
    c.json({ userId: c.get('userId' as never), workspaceId: c.get('workspaceId' as never) }),
  );
  return app;
};

describe('heterogeneous operation auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '1');
    mockExtractBearerToken.mockReturnValue('operation-token');
    mockValidateHeteroOperationJWT.mockResolvedValue({
      capabilities: ['model:invoke'],
      operation_id: 'operation-1',
      sub: 'user-1',
    });
    mockGetServerDB.mockResolvedValue({});
    mockResolveActiveHeteroOperationPrincipal.mockResolvedValue({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authorizes an active operation while server-default agents are enabled', async () => {
    const response = await createApp().request('/invoke', {
      headers: { Authorization: 'Bearer operation-token' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(mockResolveActiveHeteroOperationPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'model:invoke', operationId: 'operation-1' }),
    );
  });

  it('rejects previously issued tokens when server-default agents are disabled', async () => {
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '0');

    const response = await createApp().request('/invoke', {
      headers: { Authorization: 'Bearer operation-token' },
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain('Server-default agents are disabled');
    expect(mockValidateHeteroOperationJWT).not.toHaveBeenCalled();
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });
});
