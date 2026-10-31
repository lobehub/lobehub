// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorsRoutes } from './connectors.route';

const service = vi.hoisted(() => ({
  authorize: vi.fn(),
  catalog: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  refresh: vi.fn(),
  reconcile: vi.fn(),
  setAgents: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/personalConnector/createService', () => ({
  createPersonalConnectorService: async () => service,
}));
vi.mock('../middleware/permission-check', () => ({
  requireAnyPermissionWithApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

const app = (user = 'owner') => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (user) c.set('userId' as never, user as never);
    await next();
  });
  return app.route('/connectors', ConnectorsRoutes);
};
const body = (value: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});
const uuid = '28c55ba6-4214-4e28-99ba-a2ba078431b2';

beforeEach(() => {
  vi.clearAllMocks();
  service.catalog.mockReturnValue([{ id: 'gmail', name: 'Gmail', available: true }]);
  service.authorize.mockImplementation(async (input) => ({
    id: uuid,
    providerId: input.providerId,
    status: 'authorizing',
    agentIds: [],
    revision: 1,
    authorization: { id: uuid, expiresAt: Date.now() + 60000, status: 'pending' },
  }));
});

describe('public curated connector API', () => {
  it('requires authentication for connection inventory', async () => {
    expect((await app('').request('/connectors')).status).toBe(401);
  });

  it('rejects custom MCP configuration before beginning an authorization', async () => {
    const response = await app().request(
      '/connectors/authorizations',
      body({
        providerId: 'gmail',
        requestId: uuid,
        serverUrl: 'https://custom.example/mcp',
      }),
    );
    expect(response.status).toBe(400);
    expect(service.authorize).not.toHaveBeenCalled();
  });

  it('rejects provider account IDs or tokens supplied instead of a local connection reference', async () => {
    const response = await app().request(
      '/connectors/authorizations',
      body({
        providerId: 'gmail',
        requestId: uuid,
        connectedAccountId: 'provider-account',
        token: 'not-a-token',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('returns an authorization operation without treating it as agent access', async () => {
    const response = await app().request(
      '/connectors/authorizations',
      body({ providerId: 'gmail', requestId: uuid }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { status: 'authorizing', agentIds: [] },
    });
  });

  it('registers catalog as a static route rather than interpreting it as a connection ID', async () => {
    const response = await app().request('/connectors/catalog');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ id: 'gmail', available: true }] });
  });

  it('requires an optimistic version when changing the agent scope', async () => {
    const response = await app().request(`/connectors/${uuid}/agents`, {
      ...body({ agentIds: ['toby'] }),
      method: 'PUT',
    });
    expect(response.status).toBe(400);
    expect(service.setAgents).not.toHaveBeenCalled();
  });
});
