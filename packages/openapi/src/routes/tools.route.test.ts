// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as McpServiceModule from '@/server/services/mcp';

/**
 * `POST /api/v1/tools/call` and the live `/api/v1/mcp-servers/{id}/tools |
 * resources | prompts` over real HTTP: real routes, auth / workspace
 * middlewares, scope gates and the shared `connector.callTool` procedure with
 * its permission model, on PGlite. Only the database handle is pointed at
 * PGlite and the remote MCP server is stubbed.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));
const mcp = vi.hoisted(() => ({
  callTool: vi.fn(),
  listPrompts: vi.fn(),
  listRawTools: vi.fn(),
  listResources: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
// The remote MCP server: everything in front of it (routes, scopes, the
// connector procedures and their permission checks) runs for real.
vi.mock('@/server/services/mcp', async (importOriginal) => ({
  ...(await importOriginal<typeof McpServiceModule>()),
  mcpService: mcp,
}));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: async () => false }));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, userConnectors, userConnectorTools, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { ToolCallResultSchema } = await import('../types/tool-call.type');
const { McpServerLiveToolListSchema, McpServerPromptListSchema, McpServerResourceListSchema } =
  await import('../types/mcp-server.type');
const ToolRoutes = (await import('./tools.route')).default;
const McpServerRoutes = (await import('./mcp-servers.route')).default;

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
app.route('/tools', ToolRoutes);
app.route('/mcp-servers', McpServerRoutes);

const OWNER = 'r7-tools-owner';
const STRANGER = 'r7-tools-stranger';
const WORKSPACE = 'r7-tools-ws';
const AGENT = 'agt_r7_tools_owner';
const STRANGER_AGENT = 'agt_r7_tools_stranger';

const KEYS = {
  invoke: 'sk-lh-r7toolsinvoke001',
  mcpRead: 'sk-lh-r7toolsmcpread01',
  mcpWrite: 'sk-lh-r7toolsmcpwrite1',
  stranger: 'sk-lh-r7toolsstranger1',
  workspace: 'sk-lh-r7toolsworkspac1',
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

const toolCall = (body: Record<string, unknown>, key: string = KEYS.invoke) =>
  call('/tools/call', { body, key, method: 'POST' });

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
  Object.values(mcp).forEach((fn) => fn.mockReset());
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
    .values([{ id: WORKSPACE, name: 'R7 tools', primaryOwnerId: OWNER, slug: 'r7-tools' }]);
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
      key(KEYS.invoke, OWNER, ['tool:invoke']),
      key(KEYS.mcpRead, OWNER, ['mcp:read']),
      key(KEYS.mcpWrite, OWNER, ['mcp:write']),
      key(KEYS.stranger, STRANGER, ['tool:invoke', 'mcp:write']),
      key(KEYS.workspace, OWNER, ['tool:invoke'], WORKSPACE),
    ]);
  mcp.callTool.mockResolvedValue({
    content: 'Found 2 issues',
    state: { content: [{ text: 'Found 2 issues', type: 'text' }] },
    success: true,
  });
});

describe('POST /tools/call — authentication and scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await toolCall({ identifier: 'linear', toolName: 'search' }, '')).status).toBe(401);
  });

  it('requires the separate tool:invoke scope, even for an mcp:write key', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'search');

    const res = await toolCall({ identifier: 'linear', toolName: 'search' }, KEYS.mcpWrite);
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('rejects a call without a tool name or with non-object arguments', async () => {
    for (const body of [
      { identifier: 'linear' },
      { arguments: 'q=1', identifier: 'linear', toolName: 'search' },
    ]) {
      const res = await toolCall(body);
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
  });
});

describe('POST /tools/call — the conversation permission model', () => {
  it('calls an auto tool with the given arguments', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'search');

    const res = await toolCall({
      arguments: { q: 'bug' },
      identifier: 'linear',
      toolName: 'search',
    });
    expect(res.status).toBe(200);
    const data = (await json(res)).data;
    expect(() => ToolCallResultSchema.parse(data)).not.toThrow();
    expect(data).toEqual({ content: 'Found 2 issues', error: null, success: true });
    expect(mcp.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ argsStr: JSON.stringify({ q: 'bug' }), toolName: 'search' }),
    );
  });

  it('refuses a tool that needs approval with approval_required, without calling it', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'create_issue', 'needs_approval');

    const res = await toolCall({ identifier: 'linear', toolName: 'create_issue' });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.code).toBe('approval_required');
    expect(body.message).toContain('requires human approval');
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('refuses a tool marked for mandatory approval even when its permission is auto', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'delete_project', 'auto', { mandatoryApproval: true });

    const res = await toolCall({ identifier: 'linear', toolName: 'delete_project' });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('approval_required');
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('refuses a disabled tool, a disabled connector and an unsynced tool name', async () => {
    const linear = await seedConnector({ identifier: 'linear' });
    await seedTool(linear, 'archive', 'disabled');
    const off = await seedConnector({ identifier: 'notion', isEnabled: false });
    await seedTool(off, 'search');

    const disabledTool = await toolCall({ identifier: 'linear', toolName: 'archive' });
    expect(disabledTool.status).toBe(403);
    expect((await json(disabledTool)).code).toBe('forbidden');

    expect((await toolCall({ identifier: 'notion', toolName: 'search' })).status).toBe(403);
    expect((await toolCall({ identifier: 'linear', toolName: 'drop_db' })).status).toBe(400);
    expect((await toolCall({ identifier: 'missing', toolName: 'search' })).status).toBe(404);
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('answers 503 when the server is unreachable and a bare 502 on any other failure', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'search');

    // What `mcpService` throws for a refused connection: a TRPCError whose cause
    // carries the MCP connection error type, which the connector procedure rethrows.
    const { TRPCError } = await import('@trpc/server');
    mcp.callTool.mockRejectedValueOnce(
      new TRPCError({
        cause: Object.assign(new Error('connect ECONNREFUSED'), {
          data: { type: 'CONNECTION_FAILED' },
        }),
        code: 'SERVICE_UNAVAILABLE',
        message: 'connect ECONNREFUSED',
      }),
    );
    const unreachable = await toolCall({ identifier: 'linear', toolName: 'search' });
    expect(unreachable.status).toBe(503);
    expect((await json(unreachable)).code).toBe('service_unavailable');

    mcp.callTool.mockRejectedValueOnce(new Error('relation "secret_table" does not exist'));
    const failed = await toolCall({ identifier: 'linear', toolName: 'search' });
    expect(failed.status).toBe(502);
    const body = await json(failed);
    expect(body.code).toBe('upstream_error');
    expect(body.message).not.toContain('secret_table');
  });

  it('reports a tool that ran and failed as success: false', async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'search');
    mcp.callTool.mockResolvedValue({
      content: 'Rate limited',
      error: { message: 'Rate limited', type: 'MCP_TOOL_ERROR' },
      state: { content: [], isError: true },
      success: false,
    });

    const data = (await json(await toolCall({ identifier: 'linear', toolName: 'search' }))).data;
    expect(data).toEqual({
      content: 'Rate limited',
      error: { message: 'Rate limited', type: 'MCP_TOOL_ERROR' },
      success: false,
    });
  });
});

describe('POST /tools/call — ownership and workspace isolation', () => {
  it("cannot call another user's connector, or resolve through another user's agent", async () => {
    const connector = await seedConnector({ identifier: 'linear' });
    await seedTool(connector, 'search');
    const agentOwned = await seedConnector({
      agentId: AGENT,
      identifier: 'github',
    });
    await seedTool(agentOwned, 'search');

    expect(
      (await toolCall({ identifier: 'linear', toolName: 'search' }, KEYS.stranger)).status,
    ).toBe(404);
    expect(
      (await toolCall({ agentId: AGENT, identifier: 'github', toolName: 'search' }, KEYS.stranger))
        .status,
    ).toBe(404);
    expect(mcp.callTool).not.toHaveBeenCalled();

    // The owner resolves the agent's own connector through the agent
    const own = await toolCall({ agentId: AGENT, identifier: 'github', toolName: 'search' });
    expect(own.status).toBe(200);
  });

  it('keeps personal and workspace connectors apart', async () => {
    const shared = await seedConnector({ identifier: 'notion', workspaceId: WORKSPACE });
    await seedTool(shared, 'search');

    expect((await toolCall({ identifier: 'notion', toolName: 'search' })).status).toBe(404);
    expect(
      (await toolCall({ identifier: 'notion', toolName: 'search' }, KEYS.workspace)).status,
    ).toBe(200);
  });

  it('refuses a workspace header the key does not belong to', async () => {
    const res = await call('/tools/call', {
      body: { identifier: 'linear', toolName: 'search' },
      key: KEYS.stranger,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});

describe('GET /mcp-servers/{id}/tools | resources | prompts', () => {
  it('answers 401 without credentials', async () => {
    const server = await seedConnector({ identifier: 'docs' });
    for (const kind of ['tools', 'resources', 'prompts']) {
      expect((await call(`/mcp-servers/${server.id}/${kind}`)).status).toBe(401);
    }
  });

  it('refuses a workspace header the key does not belong to', async () => {
    const server = await seedConnector({ identifier: 'docs' });
    const res = await call(`/mcp-servers/${server.id}/tools`, {
      key: KEYS.stranger,
      workspaceId: WORKSPACE,
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('asks the server live and answers typed lists', async () => {
    const server = await seedConnector({ identifier: 'docs' });
    mcp.listRawTools.mockResolvedValue([
      { description: 'Search docs', inputSchema: { type: 'object' }, name: 'search' },
    ]);
    mcp.listResources.mockResolvedValue([{ name: 'Guide', uri: 'docs://guide' }]);
    mcp.listPrompts.mockResolvedValue([
      { arguments: [{ name: 'topic', required: true }], name: 'summarize' },
    ]);

    const tools = (await json(await call(`/mcp-servers/${server.id}/tools`, { key: KEYS.mcpRead })))
      .data;
    expect(() => McpServerLiveToolListSchema.parse(tools)).not.toThrow();
    expect(tools.items).toEqual([
      { description: 'Search docs', inputSchema: { type: 'object' }, name: 'search' },
    ]);
    expect(mcp.listRawTools).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'http', url: 'https://docs.example.com/mcp' }),
    );

    const resources = (
      await json(await call(`/mcp-servers/${server.id}/resources`, { key: KEYS.mcpRead }))
    ).data;
    expect(() => McpServerResourceListSchema.parse(resources)).not.toThrow();
    expect(resources.items).toEqual([
      { description: null, mimeType: null, name: 'Guide', uri: 'docs://guide' },
    ]);

    const prompts = (
      await json(await call(`/mcp-servers/${server.id}/prompts`, { key: KEYS.mcpRead }))
    ).data;
    expect(() => McpServerPromptListSchema.parse(prompts)).not.toThrow();
    expect(prompts.items).toEqual([
      {
        arguments: [{ description: null, name: 'topic', required: true }],
        description: null,
        name: 'summarize',
      },
    ]);
  });

  it('maps the tRPC errors mcpService raises: unreachable → 503, failed → 502', async () => {
    const server = await seedConnector({ identifier: 'docs' });
    const trpcError = (code: string, message: string) =>
      Object.assign(new Error(message), { code, name: 'TRPCError' });

    mcp.listPrompts.mockRejectedValue(trpcError('SERVICE_UNAVAILABLE', 'connect ECONNREFUSED'));
    const unreachable = await call(`/mcp-servers/${server.id}/prompts`, { key: KEYS.mcpRead });
    expect(unreachable.status).toBe(503);
    expect((await json(unreachable)).code).toBe('service_unavailable');

    mcp.listRawTools.mockRejectedValue(trpcError('INTERNAL_SERVER_ERROR', 'Error listing tools'));
    const failed = await call(`/mcp-servers/${server.id}/tools`, { key: KEYS.mcpRead });
    expect(failed.status).toBe(502);
    expect((await json(failed)).code).toBe('upstream_error');
  });

  it('answers 502 upstream_error when the server fails', async () => {
    const server = await seedConnector({ identifier: 'docs' });
    mcp.listResources.mockRejectedValue(new Error('socket hang up'));

    const res = await call(`/mcp-servers/${server.id}/resources`, { key: KEYS.mcpRead });
    expect(res.status).toBe(502);
    expect((await json(res)).code).toBe('upstream_error');
  });

  it("requires mcp:read, and hides another user's server", async () => {
    const server = await seedConnector({ identifier: 'docs' });

    const scoped = await call(`/mcp-servers/${server.id}/tools`, { key: KEYS.invoke });
    expect(scoped.status).toBe(403);
    expect((await json(scoped)).code).toBe('insufficient_scope');

    expect((await call(`/mcp-servers/${server.id}/prompts`, { key: KEYS.stranger })).status).toBe(
      404,
    );
    expect((await call('/mcp-servers/not-a-uuid/tools', { key: KEYS.mcpRead })).status).toBe(400);
    expect(mcp.listRawTools).not.toHaveBeenCalled();
    expect(mcp.listPrompts).not.toHaveBeenCalled();
  });
});

describe('POST /mcp-servers/{id}/tools/call', () => {
  it('calls a synced tool of the server by id', async () => {
    const server = await seedConnector({ identifier: 'docs' });
    await seedTool(server, 'search');

    const res = await call(`/mcp-servers/${server.id}/tools/call`, {
      body: { arguments: { q: 'auth' }, toolName: 'search' },
      key: KEYS.invoke,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ content: 'Found 2 issues', success: true });
  });

  it('runs the addressed server when a sibling shares its identifier', async () => {
    // A workspace holds a shared `docs` server and the caller's private `docs`
    // server: the id-addressed route must run the row it addressed, not the
    // shared sibling the identifier also resolves to.
    const shared = await seedConnector({ identifier: 'docs', workspaceId: WORKSPACE });
    const own = await seedConnector({
      identifier: 'docs',
      mcpServerUrl: 'https://private-docs.example.com/mcp',
      visibility: 'private',
      workspaceId: WORKSPACE,
    });
    await seedTool(shared, 'search');
    await seedTool(own, 'search');

    const res = await call(`/mcp-servers/${own.id}/tools/call`, {
      body: { arguments: { q: 'auth' }, toolName: 'search' },
      key: KEYS.workspace,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(200);
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
    expect(mcp.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        clientParams: expect.objectContaining({ url: 'https://private-docs.example.com/mcp' }),
      }),
    );
  });

  it('applies the same approval gate as POST /tools/call', async () => {
    const server = await seedConnector({ identifier: 'docs' });
    await seedTool(server, 'publish', 'needs_approval');

    const res = await call(`/mcp-servers/${server.id}/tools/call`, {
      body: { toolName: 'publish' },
      key: KEYS.invoke,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('approval_required');
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it("requires tool:invoke, validates the body and hides another user's server", async () => {
    const server = await seedConnector({ identifier: 'docs' });
    await seedTool(server, 'search');
    const path = `/mcp-servers/${server.id}/tools/call`;

    expect((await call(path, { body: { toolName: 'search' }, method: 'POST' })).status).toBe(401);
    const noScope = await call(path, {
      body: { toolName: 'search' },
      key: KEYS.mcpWrite,
      method: 'POST',
    });
    expect(noScope.status).toBe(403);
    expect((await json(noScope)).code).toBe('insufficient_scope');
    expect((await call(path, { body: {}, key: KEYS.invoke, method: 'POST' })).status).toBe(400);
    expect(
      (await call(path, { body: { toolName: 'search' }, key: KEYS.stranger, method: 'POST' }))
        .status,
    ).toBe(404);
    expect(mcp.callTool).not.toHaveBeenCalled();
  });
});
