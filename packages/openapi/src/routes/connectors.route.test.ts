// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConnectorOAuthModule from '@/server/services/connector/oauth';
import type * as ConnectorStateStoreModule from '@/server/services/connector/stateStore';
import type * as ConnectorSyncModule from '@/server/services/connector/sync';

/**
 * `/api/v1/connectors` over real HTTP: the real routes behind the `app.ts`
 * auth and workspace middlewares, the real permission/scope gates, controller,
 * REST service and the shared `connector` procedures, on PGlite. API keys are
 * real `api_keys` rows. Only the database handle is pointed at PGlite and the
 * remote MCP / OAuth network calls are stubbed.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));
const network = vi.hoisted(() => ({
  buildAuthorizationUrl: vi.fn(),
  discoverConnectorOAuth: vi.fn(),
  resolveConnectorClient: vi.fn(),
  saveConnectorOAuthState: vi.fn(),
  syncConnectorToolsById: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/server/services/connector/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof ConnectorOAuthModule>()),
  buildAuthorizationUrl: network.buildAuthorizationUrl,
  discoverConnectorOAuth: network.discoverConnectorOAuth,
  resolveConnectorClient: network.resolveConnectorClient,
}));
vi.mock('@/server/services/connector/stateStore', async (importOriginal) => ({
  ...(await importOriginal<typeof ConnectorStateStoreModule>()),
  saveConnectorOAuthState: network.saveConnectorOAuthState,
}));
vi.mock('@/server/services/connector/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof ConnectorSyncModule>()),
  syncConnectorToolsById: network.syncConnectorToolsById,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, userConnectors, userConnectorTools, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { ConnectorListSchema, ConnectorSchema, ConnectorToolSchema } =
  await import('../types/connector.type');
const ConnectorRoutes = (await import('./connectors.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/connectors', ConnectorRoutes);

const OWNER = 'r7-conn-owner';
const STRANGER = 'r7-conn-stranger';
const WORKSPACE = 'r7-conn-ws';
const AGENT = 'agt_r7_conn_owner';
const STRANGER_AGENT = 'agt_r7_conn_stranger';

const KEYS = {
  agentOnly: 'sk-lh-r7connagentonly1',
  ownerRead: 'sk-lh-r7connownerread1',
  ownerWrite: 'sk-lh-r7connownerwrit1',
  stranger: 'sk-lh-r7connstranger01',
  workspace: 'sk-lh-r7connworkspace1',
} as const;

const call = (
  path: string,
  init: { body?: unknown; key?: string; method?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

const seedConnector = async (
  values: Partial<typeof userConnectors.$inferInsert> & { identifier: string },
) => {
  const [row] = await serverDB
    .insert(userConnectors)
    .values({
      mcpConnectionType: 'http',
      mcpServerUrl: `https://${values.identifier}.example.com/mcp`,
      name: values.identifier,
      sourceType: 'custom',
      status: 'connected',
      userId: OWNER,
      ...values,
    })
    .returning();
  return row;
};

const seedTool = async (
  connector: { id: string; userId: string; workspaceId?: string | null },
  toolName: string,
  permission = 'auto',
  metadata: Record<string, unknown> | null = null,
) => {
  const [row] = await serverDB
    .insert(userConnectorTools)
    .values({
      crudType: 'read',
      description: `${toolName} tool`,
      inputSchema: { properties: { q: { type: 'string' } }, type: 'object' },
      metadata,
      permission,
      toolName,
      userConnectorId: connector.id,
      userId: connector.userId,
      workspaceId: connector.workspaceId ?? null,
    })
    .returning();
  return row;
};

beforeEach(async () => {
  Object.values(network).forEach((fn) => fn.mockReset());
  await serverDB.delete(userConnectorTools);
  await serverDB.delete(userConnectors);
  await serverDB.delete(agents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R7 conn', primaryOwnerId: OWNER, slug: 'r7-conn' }]);
  await serverDB
    .insert(workspaceMembers)
    .values([{ role: 'owner', userId: OWNER, workspaceId: WORKSPACE }]);
  await serverDB.insert(agents).values([
    { id: AGENT, title: 'Owner agent', userId: OWNER },
    { id: STRANGER_AGENT, title: 'Stranger agent', userId: STRANGER },
  ]);
  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.ownerWrite, OWNER, ['mcp:write']),
      key(KEYS.ownerRead, OWNER, ['mcp:read']),
      key(KEYS.agentOnly, OWNER, ['agent:write']),
      key(KEYS.stranger, STRANGER, ['mcp:write']),
      key(KEYS.workspace, OWNER, ['mcp:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    for (const [path, method] of [
      ['/connectors', 'GET'],
      [`/connectors/${connector.id}`, 'GET'],
      [`/connectors/${connector.id}/tools`, 'GET'],
      [`/connectors/${connector.id}`, 'DELETE'],
      [`/connectors/${connector.id}/sync`, 'POST'],
      [`/connectors/${connector.id}/agent`, 'DELETE'],
    ] as const) {
      expect((await call(path, { method })).status).toBe(401);
    }
  });

  it('refuses a key without an mcp scope', async () => {
    const res = await call('/connectors', { key: KEYS.agentOnly });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets an mcp:read key read but not change a connector', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    expect((await call(`/connectors/${connector.id}`, { key: KEYS.ownerRead })).status).toBe(200);

    for (const [path, method] of [
      [`/connectors/${connector.id}`, 'DELETE'],
      [`/connectors/${connector.id}/sync`, 'POST'],
    ] as const) {
      const res = await call(path, { key: KEYS.ownerRead, method });
      expect(res.status).toBe(403);
    }
  });
});

describe('request validation', () => {
  it('rejects a non-uuid id and an unknown permission', async () => {
    expect((await call('/connectors/not-a-uuid', { key: KEYS.ownerRead })).status).toBe(400);

    const connector = await seedConnector({ identifier: 'linear' });
    const tool = await seedTool(connector, 'search');
    const res = await call(`/connectors/${connector.id}/tools/${tool.id}`, {
      body: { permission: 'sometimes' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });
});

describe('reading connectors', () => {
  it('lists connectors with their tools and never returns credentials', async () => {
    const linear = await seedConnector({
      credentials: 'ciphertext-never-returned',
      identifier: 'linear',
    });
    await seedTool(linear, 'search');
    await seedTool(linear, 'create_issue', 'needs_approval');
    await seedConnector({ identifier: 'notion' });

    const res = await call('/connectors', { key: KEYS.ownerRead });
    expect(res.status).toBe(200);
    const page = (await json(res)).data;
    expect(() => ConnectorListSchema.parse(page)).not.toThrow();
    expect(page.total).toBe(2);
    expect(JSON.stringify(page)).not.toContain('ciphertext');

    const item = page.items.find((c: any) => c.identifier === 'linear');
    expect(item).toMatchObject({
      connectionType: 'http',
      hasCredentials: true,
      status: 'connected',
    });
    expect(item.tools.map((t: any) => [t.name, t.permission, t.requiresApproval]).sort()).toEqual([
      ['create_issue', 'needs_approval', true],
      ['search', 'auto', false],
    ]);

    const paged = (await json(await call('/connectors?limit=1', { key: KEYS.ownerRead }))).data;
    expect(paged).toMatchObject({ hasMore: true, total: 2 });

    const tools = await call(`/connectors/${linear.id}/tools`, { key: KEYS.ownerRead });
    expect((await json(tools)).data.items.map((t: any) => t.name).sort()).toEqual([
      'create_issue',
      'search',
    ]);
  });

  it("lists an agent's connectors and hides an agent the caller cannot see", async () => {
    const owned = await seedConnector({ agentId: AGENT, identifier: 'github' });
    await seedConnector({ identifier: 'linear' });

    const list = (await json(await call(`/connectors?agentId=${AGENT}`, { key: KEYS.ownerRead })))
      .data;
    expect(list.items.map((c: any) => c.id)).toEqual([owned.id]);

    const res = await call(`/connectors?agentId=${STRANGER_AGENT}`, { key: KEYS.ownerRead });
    expect(res.status).toBe(404);
  });
});

describe('writes through the shared connector procedures', () => {
  it('starts an OAuth connection and returns the authorization URL', async () => {
    const connector = await seedConnector({ identifier: 'linear', status: 'disconnected' });
    network.discoverConnectorOAuth.mockResolvedValue({
      authorizationServerUrl: 'https://auth.linear.app',
      metadata: { authorization_endpoint: 'https://auth.linear.app/authorize' },
    });
    network.resolveConnectorClient.mockResolvedValue({ clientId: 'client-1', scheme: 'dcr' });
    network.buildAuthorizationUrl.mockResolvedValue({
      authorizationUrl: new URL('https://auth.linear.app/authorize?client_id=client-1'),
      codeVerifier: 'verifier',
    });

    const res = await call(`/connectors/${connector.id}/authorize`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = (await json(res)).data;
    expect(data.authorizationUrl).toBe('https://auth.linear.app/authorize?client_id=client-1');
    expect(typeof data.flowId).toBe('string');
    expect(network.saveConnectorOAuthState).toHaveBeenCalledWith(
      data.flowId,
      expect.objectContaining({ connectorId: connector.id, lobeUserId: OWNER }),
    );
  });

  it('syncs tools and sets a tool permission', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    const tool = await seedTool(connector, 'create_issue');
    network.syncConnectorToolsById.mockResolvedValue({ toolCount: 3 });

    const sync = await call(`/connectors/${connector.id}/sync`, {
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect((await json(sync)).data).toEqual({ id: connector.id, toolCount: 3 });

    const res = await call(`/connectors/${connector.id}/tools/${tool.id}`, {
      body: { permission: 'needs_approval' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    const updated = (await json(res)).data;
    expect(() => ConnectorToolSchema.parse(updated)).not.toThrow();
    expect(updated).toMatchObject({ permission: 'needs_approval', requiresApproval: true });
  });

  it('404s a tool addressed through another connector', async () => {
    const linear = await seedConnector({ identifier: 'linear' });
    const notion = await seedConnector({ identifier: 'notion' });
    const tool = await seedTool(notion, 'search');

    const res = await call(`/connectors/${linear.id}/tools/${tool.id}`, {
      body: { permission: 'disabled' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(res.status).toBe(404);
  });

  it('binds, unbinds, mounts and unmounts a connector on an agent', async () => {
    const connector = await seedConnector({ identifier: 'linear' });

    const bound = await call(`/connectors/${connector.id}/agent`, {
      body: { agentId: AGENT },
      key: KEYS.ownerWrite,
      method: 'PUT',
    });
    expect(bound.status).toBe(200);
    const boundData = (await json(bound)).data;
    expect(() => ConnectorSchema.parse(boundData)).not.toThrow();
    const [afterBind] = await serverDB.select().from(userConnectors);
    expect(afterBind.agentId).toBe(AGENT);

    const unbound = await call(`/connectors/${connector.id}/agent`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(unbound)).data).toMatchObject({ agentId: null, mountedByAgentId: null });

    const mounted = await call(`/connectors/${connector.id}/agent`, {
      body: { agentId: AGENT, mode: 'mount' },
      key: KEYS.ownerWrite,
      method: 'PUT',
    });
    expect((await json(mounted)).data).toMatchObject({ agentId: null, mountedByAgentId: AGENT });

    const unmounted = await call(`/connectors/${connector.id}/agent`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(unmounted)).data).toMatchObject({ mountedByAgentId: null });
  });

  it('refuses to attach a connector to an agent the caller cannot see', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    const res = await call(`/connectors/${connector.id}/agent`, {
      body: { agentId: STRANGER_AGENT },
      key: KEYS.ownerWrite,
      method: 'PUT',
    });
    expect(res.status).toBe(404);
    const [row] = await serverDB.select().from(userConnectors);
    expect(row.agentId).toBeNull();
  });

  it('disconnects and removes a connector with its tools', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'search');

    const res = await call(`/connectors/${connector.id}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(res)).data).toEqual({ deleted: true, id: connector.id });
    expect(await serverDB.select().from(userConnectors)).toHaveLength(0);
    expect(await serverDB.select().from(userConnectorTools)).toHaveLength(0);
  });
});

describe('ownership and workspace isolation', () => {
  it("hides another user's connector on every route", async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    const tool = await seedTool(connector, 'search');

    const attempts = [
      call(`/connectors/${connector.id}`, { key: KEYS.stranger }),
      call(`/connectors/${connector.id}/tools`, { key: KEYS.stranger }),
      call(`/connectors/${connector.id}`, { key: KEYS.stranger, method: 'DELETE' }),
      call(`/connectors/${connector.id}/sync`, { key: KEYS.stranger, method: 'POST' }),
      call(`/connectors/${connector.id}/authorize`, {
        body: {},
        key: KEYS.stranger,
        method: 'POST',
      }),
      call(`/connectors/${connector.id}/tools/${tool.id}`, {
        body: { permission: 'auto' },
        key: KEYS.stranger,
        method: 'PATCH',
      }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect(network.syncConnectorToolsById).not.toHaveBeenCalled();
    expect((await json(await call('/connectors', { key: KEYS.stranger }))).data.total).toBe(0);
  });

  it('keeps personal and workspace connectors apart', async () => {
    const personal = await seedConnector({ identifier: 'linear' });
    const shared = await seedConnector({ identifier: 'notion', workspaceId: WORKSPACE });

    const workspaceList = (await json(await call('/connectors', { key: KEYS.workspace }))).data;
    expect(workspaceList.items.map((c: any) => c.id)).toEqual([shared.id]);
    expect((await call(`/connectors/${personal.id}`, { key: KEYS.workspace })).status).toBe(404);
    expect((await call(`/connectors/${shared.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('refuses a workspace header the key does not belong to', async () => {
    const res = await call('/connectors', { key: KEYS.stranger, workspaceId: WORKSPACE });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});
