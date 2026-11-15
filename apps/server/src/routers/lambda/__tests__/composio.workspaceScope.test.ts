// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';

import { composioRouter } from '../composio';

// `vi.mock` is hoisted above the imports at runtime, so the mocks are active
// when the router module is evaluated. Kept below the imports to satisfy
// `import-x/first`.
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
const composioClientMocks = vi.hoisted(() => ({ deleteAccount: vi.fn() }));
const workspaceMocks = vi.hoisted(() => ({
  getConnectorMemberManage: vi.fn(async () => 'all_members' as const),
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return workspaceMocks;
  }),
}));
// A pre-configured auth config short-circuits the discovery branch.
vi.mock('@/config/composio', () => ({ getServerComposioAuthConfigId: () => 'auth-cfg-1' }));
vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      delete: composioClientMocks.deleteAccount,
      link: async () => ({ id: 'acc-1', redirectUrl: 'http://redirect' }),
    },
    tools: { getRawComposioTools: async () => ({ items: [] }) },
  }),
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  // The real `wsCompatProcedure` validates a Better-Auth session; for unit tests
  // we skip auth and rely on the test ctx already carrying userId/workspaceId.
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

describe('composioRouter — workspace scoping (workspace-agent connector bug)', () => {
  // Regression for the bug where a Composio connection bound to a WORKSPACE agent
  // landed as (workspace_id=NULL, agent_id=agent) because the composio procedure
  // built a personal-scoped ConnectorModel. The workspace runtime (ownership() =
  // workspace_id = wsId) then never resolved it, so the tool showed "not
  // installed". The fix threads ctx.workspaceId into the model constructor.
  let connectorModelMock: any;
  let connectorToolModelMock: any;
  let pluginModelMock: any;
  let agentModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('all_members');
    connectorModelMock = {
      create: vi.fn().mockResolvedValue({ id: 'conn-new' }),
      // The row a write updates — the caller's own row in either visibility.
      findManageableByIdentifier: vi.fn().mockResolvedValue(null),
      // The shared row only (the lookup a create of a new row uses).
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
      // By default the account a write names is held by the row the write
      // resolves (the implementation is read without recording a lookup call).
      queryComposioAccountHolders: vi.fn(async () => {
        const row = await connectorModelMock.findManageableByIdentifier.getMockImplementation()?.();
        return row ? [row] : [];
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    connectorToolModelMock = { deleteToolsNotIn: vi.fn(), upsertMany: vi.fn() };
    pluginModelMock = {
      create: vi.fn(),
      delete: vi.fn(),
      deleteComposioMirrors: vi.fn(),
      findById: vi.fn(),
      queryComposioMirrors: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    };
    agentModelMock = { existsOwnedById: vi.fn().mockResolvedValue(true) };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return connectorToolModelMock;
    });
    vi.mocked(PluginModel).mockImplementation(function () {
      return pluginModelMock;
    });
    vi.mocked(AgentModel).mockImplementation(function () {
      return agentModelMock;
    });
  });

  const callerFor = (workspaceId?: string) =>
    composioRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: workspaceId ?? null,
    } as any);

  const agentInput = {
    agentId: 'agent-1',
    appSlug: 'gmail',
    identifier: 'gmail',
    label: 'Gmail',
  };

  it('builds the connector model WITH the workspaceId, so a workspace-agent connection is workspace-scoped', async () => {
    await callerFor('ws-1').createConnection(agentInput);

    // The crux: before the fix the model was `new ConnectorModel(db, userId)`
    // (no wsId) → row (workspace_id=NULL, agent_id=agent-1). Now it carries wsId.
    expect(ConnectorModel).toHaveBeenCalledWith(expect.anything(), 'user_test', 'ws-1');
    expect(connectorToolModelMock).toBeDefined();
    expect(ConnectorToolModel).toHaveBeenCalledWith(expect.anything(), 'user_test', 'ws-1');
    // The row is agent-scoped (agent_id set), and together with wsId that makes it
    // the workspace-agent dimension the runtime can resolve.
    expect(connectorModelMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', identifier: 'gmail' }),
    );
  });

  it('scopes the agent edit-rights check to the workspace', async () => {
    await callerFor('ws-1').createConnection(agentInput);

    expect(AgentModel).toHaveBeenCalledWith(expect.anything(), 'user_test', 'ws-1');
    expect(agentModelMock.existsOwnedById).toHaveBeenCalledWith('agent-1');
  });

  it('skips the legacy plugin-table projection for agent connections', async () => {
    await callerFor('ws-1').createConnection(agentInput);

    expect(pluginModelMock.create).not.toHaveBeenCalled();
  });

  it('personal connection (no workspace) still builds a personal-scoped model — unchanged', async () => {
    await callerFor().createConnection({ appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' });

    expect(ConnectorModel).toHaveBeenCalledWith(expect.anything(), 'user_test', undefined);
    // Personal (non-agent) connections DO keep writing the legacy plugin row.
    expect(pluginModelMock.create).toHaveBeenCalled();
  });

  it('updateComposioPlugin also scopes the model + agent check to the workspace', async () => {
    // createConnection already wrote the agent's row with the pending account.
    connectorModelMock.findManageableByIdentifier.mockResolvedValue({
      agentId: 'agent-1',
      id: 'conn-agent',
      metadata: { composio: { connectedAccountId: 'acc-1' } },
      userId: 'user_test',
      visibility: 'public',
    });

    await callerFor('ws-1').updateComposioPlugin({
      agentId: 'agent-1',
      appSlug: 'gmail',
      authConfigId: 'auth-cfg-1',
      connectedAccountId: 'acc-1',
      identifier: 'gmail',
      label: 'Gmail',
      status: 'ACTIVE',
      tools: [],
    });

    expect(ConnectorModel).toHaveBeenCalledWith(expect.anything(), 'user_test', 'ws-1');
    expect(AgentModel).toHaveBeenCalledWith(expect.anything(), 'user_test', 'ws-1');
    expect(agentModelMock.existsOwnedById).toHaveBeenCalledWith('agent-1');
  });

  const memberCaller = () =>
    composioRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

  it('lets a member reconnect another member’s workspace connection by default', async () => {
    // Shared connectors are co-maintained unless an admin restricted them.
    const sharedRow = {
      agentId: null,
      id: 'conn-other',
      identifier: 'gmail',
      userId: 'another-user',
      visibility: 'public' as const,
    };
    connectorModelMock.findManageableByIdentifier.mockResolvedValue(sharedRow);
    connectorModelMock.findScopedByIdentifier.mockResolvedValue(sharedRow);

    await expect(
      memberCaller().createConnection({ appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' }),
    ).resolves.toBeDefined();
    expect(connectorModelMock.update).toHaveBeenCalledWith('conn-other', expect.anything());
  });

  it('lets a member reconnect their own private connection when admins restricted management', async () => {
    // Regression: the gate looked up the shared row while the write updates the
    // caller's own private row, so `admins_only` blocked the owner from
    // reconnecting a connector that is theirs alone. The gate must judge the
    // row the write touches.
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');
    connectorModelMock.findManageableByIdentifier.mockResolvedValue({
      agentId: null,
      id: 'conn-private',
      identifier: 'gmail',
      userId: 'user_test',
      visibility: 'private',
    });

    await expect(
      memberCaller().createConnection({ appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' }),
    ).resolves.toBeDefined();

    expect(connectorModelMock.create).not.toHaveBeenCalled();
    expect(connectorModelMock.update).toHaveBeenCalledWith('conn-private', expect.anything());
  });

  it('still blocks a member from the shared connection when they also have no private one', async () => {
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');
    connectorModelMock.findManageableByIdentifier.mockResolvedValue({
      agentId: null,
      id: 'conn-shared',
      identifier: 'gmail',
      userId: 'user_test',
      visibility: 'public',
    });

    await expect(
      memberCaller().createConnection({ appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(connectorModelMock.update).not.toHaveBeenCalled();
  });

  describe('binds the account a write names to the connector it runs on', () => {
    // The plugin projection is workspace-wide, so every member reads every
    // account id in it, privatized connections included, and the Composio
    // client deletes an account by its id alone. A write is judged on the rows
    // that actually hold the account, not on the identifier it names.
    const sharedRow = {
      agentId: null,
      id: 'conn-shared',
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'acc-shared' } },
      userId: 'another-user',
      visibility: 'public' as const,
    };
    const matePrivateRow = {
      agentId: null,
      id: 'conn-mate',
      identifier: 'gmail',
      userId: 'another-user',
      visibility: 'private' as const,
    };
    const refresh = (connectedAccountId: string, identifier = 'gmail') =>
      memberCaller().updateComposioPlugin({
        appSlug: identifier,
        authConfigId: 'auth-cfg-1',
        connectedAccountId,
        identifier,
        label: identifier,
        status: 'ACTIVE',
        tools: [],
      });

    const expectNothingWritten = () => {
      expect(composioClientMocks.deleteAccount).not.toHaveBeenCalled();
      expect(connectorModelMock.delete).not.toHaveBeenCalled();
      expect(connectorModelMock.update).not.toHaveBeenCalled();
      expect(connectorModelMock.create).not.toHaveBeenCalled();
      expect(pluginModelMock.delete).not.toHaveBeenCalled();
    };

    it('refuses an account held by a teammate’s private connector', async () => {
      // Removing it through the shared row the member can see would delete the
      // teammate's remote account; refreshing it would copy it onto that row.
      connectorModelMock.findManageableByIdentifier.mockResolvedValue(sharedRow);
      connectorModelMock.queryComposioAccountHolders.mockResolvedValue([matePrivateRow]);

      await expect(
        memberCaller().deleteConnection({ connectedAccountId: 'acc-private', identifier: 'gmail' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(refresh('acc-private')).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(connectorModelMock.queryComposioAccountHolders).toHaveBeenCalledWith('acc-private');
      expectNothingWritten();
    });

    it('refuses it under any identifier the request names', async () => {
      // ROOT CAUSE:
      //
      // The private-account check also matched on the request's identifier, so
      // naming another app missed the teammate's `gmail` row; the policy was
      // judged on an unrelated (or no) row and the account was deleted.
      connectorModelMock.findManageableByIdentifier.mockResolvedValue(null);
      connectorModelMock.queryComposioAccountHolders.mockResolvedValue([matePrivateRow]);

      await expect(
        memberCaller().deleteConnection({
          connectedAccountId: 'acc-private',
          identifier: 'notion',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(refresh('acc-private', 'notion')).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expectNothingWritten();
    });

    it('refuses it when a row of the caller’s names the account too', async () => {
      // A connector's metadata is client-written: a member can add a private
      // row naming the teammate's account and remove "their own" connection.
      const forged = {
        ...matePrivateRow,
        id: 'conn-forged',
        metadata: { composio: { connectedAccountId: 'acc-private' } },
        userId: 'user_test',
      };
      connectorModelMock.findManageableByIdentifier.mockResolvedValue(forged);
      connectorModelMock.queryComposioAccountHolders.mockResolvedValue([forged, matePrivateRow]);

      await expect(
        memberCaller().deleteConnection({ connectedAccountId: 'acc-private', identifier: 'gmail' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expectNothingWritten();
    });

    it('refuses an account a connector the member may not maintain runs', async () => {
      // A private row is exempt from the shared-connector policy; naming the
      // shared account in one must not reach a shared row that admins locked.
      workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');
      const forged = {
        ...matePrivateRow,
        id: 'conn-forged',
        metadata: { composio: { connectedAccountId: 'acc-shared' } },
        userId: 'user_test',
      };
      connectorModelMock.findManageableByIdentifier.mockResolvedValue(forged);
      connectorModelMock.queryComposioAccountHolders.mockResolvedValue([forged, sharedRow]);

      await expect(
        memberCaller().deleteConnection({ connectedAccountId: 'acc-shared', identifier: 'gmail' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expectNothingWritten();
    });

    it('refuses an account another connector runs', async () => {
      connectorModelMock.findManageableByIdentifier.mockResolvedValue(sharedRow);
      connectorModelMock.queryComposioAccountHolders.mockResolvedValue([
        { ...sharedRow, id: 'conn-github', identifier: 'github' },
      ]);

      await expect(
        memberCaller().deleteConnection({ connectedAccountId: 'acc-github', identifier: 'gmail' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expectNothingWritten();
    });

    it('acts on a legacy connection only through the app’s own projection', async () => {
      // No connector row runs a legacy account: it exists as a plugin
      // projection row of the app, under the shared connector policy.
      connectorModelMock.findManageableByIdentifier.mockResolvedValue(sharedRow);
      connectorModelMock.queryComposioAccountHolders.mockResolvedValue([]);
      pluginModelMock.queryComposioMirrors.mockResolvedValue([
        { customParams: { composio: { connectedAccountId: 'acc-legacy' } }, identifier: 'gmail' },
      ]);

      await expect(
        memberCaller().deleteConnection({ connectedAccountId: 'acc-unknown', identifier: 'gmail' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expectNothingWritten();

      await memberCaller().deleteConnection({
        connectedAccountId: 'acc-legacy',
        identifier: 'gmail',
      });

      expect(pluginModelMock.queryComposioMirrors).toHaveBeenCalledWith(['gmail']);
      expect(composioClientMocks.deleteAccount).toHaveBeenCalledWith('acc-legacy');
      expect(connectorModelMock.delete).toHaveBeenCalledWith('conn-shared');
    });

    it('never treats an agent connection as a legacy one', async () => {
      // Agent connections have no plugin projection, so a base legacy account
      // must not be removed through an agent's row.
      connectorModelMock.queryComposioAccountHolders.mockResolvedValue([]);
      pluginModelMock.queryComposioMirrors.mockResolvedValue([
        { customParams: { composio: { connectedAccountId: 'acc-legacy' } }, identifier: 'gmail' },
      ]);

      await expect(
        memberCaller().deleteConnection({
          agentId: 'agent-1',
          connectedAccountId: 'acc-legacy',
          identifier: 'gmail',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(pluginModelMock.queryComposioMirrors).not.toHaveBeenCalled();
      expectNothingWritten();
    });
  });

  it('removes the shared account’s row, not the caller’s private one', async () => {
    // The lookup by account resolves the shared row; the member policy is then
    // judged on that row, and that row is the one deleted.
    const sharedRow = {
      agentId: null,
      id: 'conn-shared',
      metadata: { composio: { connectedAccountId: 'acc-shared' } },
      userId: 'another-user',
      visibility: 'public' as const,
    };
    connectorModelMock.findManageableByIdentifier.mockResolvedValue(sharedRow);

    await memberCaller().deleteConnection({
      connectedAccountId: 'acc-shared',
      identifier: 'gmail',
    });

    expect(connectorModelMock.findManageableByIdentifier).toHaveBeenCalledWith(
      'gmail',
      undefined,
      'acc-shared',
    );
    expect(connectorModelMock.queryComposioAccountHolders).toHaveBeenCalledWith('acc-shared');
    expect(composioClientMocks.deleteAccount).toHaveBeenCalledWith('acc-shared');
    expect(connectorModelMock.delete).toHaveBeenCalledWith('conn-shared');
    // The shared connection is the workspace's projection of the app.
    expect(pluginModelMock.delete).toHaveBeenCalledWith('gmail');
    expect(pluginModelMock.deleteComposioMirrors).not.toHaveBeenCalled();
  });

  describe('a private connection’s plugin projection', () => {
    // Every member's projection row of an app is in a workspace's scope. A
    // private connection is one member's, so writing or removing the projection
    // by identifier would replace or drop a teammate's legacy connection.
    const privateRow = {
      agentId: null,
      id: 'conn-private',
      metadata: { composio: { connectedAccountId: 'acc-private' } },
      userId: 'user_test',
      visibility: 'private' as const,
    };
    const refresh = {
      appSlug: 'gmail',
      authConfigId: 'auth-cfg-1',
      connectedAccountId: 'acc-private',
      identifier: 'gmail',
      label: 'Gmail',
      status: 'ACTIVE',
      tools: [],
    };

    beforeEach(() => {
      connectorModelMock.findManageableByIdentifier.mockResolvedValue(privateRow);
      pluginModelMock.findById.mockResolvedValue({ identifier: 'gmail', manifest: {} });
    });

    it('refreshes only the caller’s own projection row', async () => {
      await memberCaller().updateComposioPlugin(refresh);

      expect(pluginModelMock.update).not.toHaveBeenCalled();
      expect(pluginModelMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customParams: {
            composio: expect.objectContaining({ connectedAccountId: 'acc-private' }),
          },
          identifier: 'gmail',
        }),
      );
    });

    it('still refreshes a shared connection across the workspace', async () => {
      connectorModelMock.findManageableByIdentifier.mockResolvedValue({
        ...privateRow,
        visibility: 'public',
      });

      await memberCaller().updateComposioPlugin(refresh);

      expect(pluginModelMock.update).toHaveBeenCalledWith('gmail', expect.anything());
      expect(pluginModelMock.create).not.toHaveBeenCalled();
    });

    it('removes only the rows mirroring its account', async () => {
      await memberCaller().deleteConnection({
        connectedAccountId: 'acc-private',
        identifier: 'gmail',
      });
      await memberCaller().removeComposioPlugin({ identifier: 'gmail' });

      expect(pluginModelMock.delete).not.toHaveBeenCalled();
      expect(pluginModelMock.deleteComposioMirrors).toHaveBeenNthCalledWith(
        1,
        'gmail',
        'acc-private',
      );
      expect(pluginModelMock.deleteComposioMirrors).toHaveBeenNthCalledWith(
        2,
        'gmail',
        'acc-private',
      );
      expect(connectorModelMock.delete).toHaveBeenCalledWith('conn-private');
    });
  });

  it('blocks a member from connecting when admins restricted connector management', async () => {
    // Checked before any remote Composio account is created — even for the
    // member's own row and for a brand-new connection.
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');

    await expect(
      memberCaller().createConnection({ appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(connectorModelMock.create).not.toHaveBeenCalled();
  });

  it('still lets a workspace admin connect when members are restricted', async () => {
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');

    await expect(
      composioRouter
        .createCaller({
          serverDB: {},
          userId: 'user_test',
          workspaceId: 'ws-1',
          workspaceRole: 'admin',
        } as any)
        .createConnection({ appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' }),
    ).resolves.toBeDefined();
  });
});
