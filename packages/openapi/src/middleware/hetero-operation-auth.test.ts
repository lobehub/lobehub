import type { ServerDefaultHeterogeneousIngress } from '@lobechat/heterogeneous-agents';
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

const createApp = (ingress: ServerDefaultHeterogeneousIngress = 'anthropic-messages') => {
  const app = new Hono();
  app.onError((error) =>
    error instanceof HTTPException ? error.getResponse() : new Response(null, { status: 500 }),
  );
  app.use('*', requireHeteroModelInvocation(ingress));
  app.get('/invoke', (c) =>
    c.json({
      agentType: c.get('heteroAgentType' as never),
      userId: c.get('userId' as never),
      workspaceId: c.get('workspaceId' as never),
    }),
  );
  return app;
};

describe('heterogeneous operation auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '1');
    mockExtractBearerToken.mockImplementation((authorization?: string) =>
      authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined,
    );
    mockValidateHeteroOperationJWT.mockResolvedValue({
      capabilities: ['model:invoke'],
      operation_id: 'operation-1',
      sub: 'user-1',
    });
    mockGetServerDB.mockResolvedValue({});
    mockResolveActiveHeteroOperationPrincipal.mockResolvedValue({
      agentType: 'claude-code',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authorizes a Claude Code Bearer token on the Anthropic ingress', async () => {
    const response = await createApp().request('/invoke', {
      headers: { Authorization: 'Bearer operation-token' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agentType: 'claude-code',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(mockResolveActiveHeteroOperationPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'model:invoke', operationId: 'operation-1' }),
    );
  });

  it('authorizes a Kimi Code x-api-key token on the Anthropic ingress', async () => {
    mockResolveActiveHeteroOperationPrincipal.mockResolvedValueOnce({
      agentType: 'kimi-code',
      userId: 'user-1',
    });

    const response = await createApp().request('/invoke', {
      headers: { 'x-api-key': 'kimi-operation-token' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agentType: 'kimi-code',
      userId: 'user-1',
    });
    expect(mockValidateHeteroOperationJWT).toHaveBeenCalledWith('kimi-operation-token');
  });

  it('rejects requests that provide both operation credential headers', async () => {
    const response = await createApp().request('/invoke', {
      headers: {
        'Authorization': 'Bearer operation-token',
        'x-api-key': 'other-operation-token',
      },
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toContain(
      'Multiple operation credentials are not allowed',
    );
    expect(mockValidateHeteroOperationJWT).not.toHaveBeenCalled();
  });

  it.each([
    ['kimi-code', 'anthropic-messages', 'Bearer operation-token'],
    ['pi', 'anthropic-messages', 'Bearer operation-token'],
    ['pi', 'openai-responses', undefined],
  ] as const)(
    'rejects %s when its ingress or credential header does not match the matrix',
    async (agentType, ingress, authorization) => {
      mockResolveActiveHeteroOperationPrincipal.mockResolvedValueOnce({
        agentType,
        userId: 'user-1',
      });
      const response = await createApp(ingress).request('/invoke', {
        headers: authorization
          ? { Authorization: authorization }
          : { 'x-api-key': 'operation-token' },
      });

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toContain(
        'Operation token cannot invoke this server model ingress',
      );
    },
  );

  it('does not accept an ordinary API key that is not an operation JWT', async () => {
    mockValidateHeteroOperationJWT.mockResolvedValueOnce(null);

    const response = await createApp().request('/invoke', {
      headers: { 'x-api-key': 'ordinary-provider-key' },
    });

    expect(response.status).toBe(401);
    expect(mockResolveActiveHeteroOperationPrincipal).not.toHaveBeenCalled();
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
