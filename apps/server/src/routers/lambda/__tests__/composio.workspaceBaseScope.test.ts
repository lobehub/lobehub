// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';

import { composioRouter } from '../composio';

const linkMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'acc-1', redirectUrl: 'http://redirect' }),
);

// Hoisted above the imports at runtime; kept below them for `import-x/first`.
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/config/composio', () => ({ getServerComposioAuthConfigId: () => 'auth-cfg-1' }));
vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    connectedAccounts: { delete: vi.fn(), link: linkMock },
    tools: { getRawComposioTools: async () => ({ items: [] }) },
  }),
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

/**
 * Workspace BASE connections (no agentId) — the scope that used to be treated
 * as "personal" simply because it wasn't agent-scoped.
 */
describe('composioRouter — workspace base scope', () => {
  let connectorModelMock: any;
  let connectorToolModelMock: any;
  let pluginModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    linkMock.mockResolvedValue({ id: 'acc-1', redirectUrl: 'http://redirect' });
    connectorModelMock = {
      create: vi.fn().mockResolvedValue({ id: 'conn-new' }),
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    };
    connectorToolModelMock = {
      deleteToolsNotIn: vi.fn(),
      queryByConnectorIds: vi.fn().mockResolvedValue([]),
      upsertMany: vi.fn(),
    };
    pluginModelMock = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    };
    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => connectorToolModelMock);
    vi.mocked(PluginModel).mockImplementation(() => pluginModelMock);
    vi.mocked(AgentModel).mockImplementation(() => ({ existsOwnedById: async () => true }) as any);
  });

  const callerFor = (workspaceId?: string) =>
    composioRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: workspaceId ?? null,
    } as any);

  const input = { appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' };

  // Our Composio user entity is the bare userId, so a workspace connection is a
  // SECOND account under the same (entity, auth config). Without allowMultiple
  // Composio rejects it outright — "Multiple connected accounts found for user
  // … Please use the allowMultiple option" — and connecting Gmail inside a
  // workspace was impossible for anyone who had connected it personally.
  it('asks Composio for an additional account when connecting inside a workspace', async () => {
    await callerFor('ws-1').createConnection(input);

    expect(linkMock).toHaveBeenCalledWith(
      'user_test',
      'auth-cfg-1',
      expect.objectContaining({ allowMultiple: true }),
    );
  });

  it('keeps the single-account default for a personal connection', async () => {
    await callerFor().createConnection(input);

    expect(linkMock.mock.calls[0][2]).not.toHaveProperty('allowMultiple');
  });

  // `user_installed_plugins` is keyed by (user_id, identifier), so a workspace
  // write upserts onto the PERSONAL row — repointing the user's personal
  // connection at the workspace's Composio account while leaving the workspace
  // with no row. Workspace connections must skip the legacy projection.
  it('does not touch the legacy plugin table for a workspace connection', async () => {
    await callerFor('ws-1').createConnection(input);

    expect(pluginModelMock.create).not.toHaveBeenCalled();
    // It still lands in user_connectors, which IS workspace-dimensioned.
    expect(connectorModelMock.create).toHaveBeenCalled();
  });

  it('still writes the legacy projection for a personal connection', async () => {
    await callerFor().createConnection(input);

    expect(pluginModelMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'gmail', source: 'composio' }),
    );
  });

  it('leaves the personal plugin row alone when a workspace connection is deleted', async () => {
    await callerFor('ws-1').deleteConnection({
      connectedAccountId: 'acc-1',
      identifier: 'gmail',
    });

    expect(pluginModelMock.delete).not.toHaveBeenCalled();
  });

  // Workspace connections live only in user_connectors, so the read path has to
  // union both stores — otherwise the workspace's own connections render as
  // "not connected" and the UI offers to redo an OAuth flow already completed.
  it('surfaces connector-only (workspace) connections through getComposioPlugins', async () => {
    connectorModelMock.query.mockResolvedValue([
      {
        id: 'conn-1',
        identifier: 'gmail',
        metadata: { composio: { appSlug: 'gmail', status: 'ACTIVE' } },
        name: 'Gmail',
      },
    ]);
    connectorToolModelMock.queryByConnectorIds.mockResolvedValue([
      {
        description: 'send',
        inputSchema: undefined,
        toolName: 'GMAIL_SEND',
        userConnectorId: 'conn-1',
      },
    ]);

    const result = await callerFor('ws-1').getComposioPlugins();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      customParams: { composio: { status: 'ACTIVE' } },
      identifier: 'gmail',
    });
    expect(result[0].manifest?.api?.[0]).toMatchObject({ name: 'GMAIL_SEND' });
  });

  it('prefers the plugin row when both stores hold the same identifier', async () => {
    pluginModelMock.query.mockResolvedValue([
      { customParams: { composio: { status: 'ACTIVE' } }, identifier: 'gmail', manifest: {} },
    ]);
    connectorModelMock.query.mockResolvedValue([
      {
        id: 'conn-1',
        identifier: 'gmail',
        metadata: { composio: { status: 'PENDING' } },
        name: 'Gmail',
      },
    ]);

    const result = await callerFor().getComposioPlugins();

    expect(result).toHaveLength(1);
    expect(result[0].customParams?.composio?.status).toBe('ACTIVE');
  });
});
