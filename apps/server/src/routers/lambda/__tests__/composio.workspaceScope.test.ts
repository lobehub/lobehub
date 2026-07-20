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
// A pre-configured auth config short-circuits the discovery branch.
vi.mock('@/config/composio', () => ({ getServerComposioAuthConfigId: () => 'auth-cfg-1' }));
vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    connectedAccounts: { link: async () => ({ id: 'acc-1', redirectUrl: 'http://redirect' }) },
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
    connectorModelMock = {
      create: vi.fn().mockResolvedValue({ id: 'conn-new' }),
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
    };
    connectorToolModelMock = { deleteToolsNotIn: vi.fn(), upsertMany: vi.fn() };
    pluginModelMock = { create: vi.fn(), findById: vi.fn(), update: vi.fn() };
    agentModelMock = { existsOwnedById: vi.fn().mockResolvedValue(true) };
    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => connectorToolModelMock);
    vi.mocked(PluginModel).mockImplementation(() => pluginModelMock);
    vi.mocked(AgentModel).mockImplementation(() => agentModelMock);
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

  it('blocks a non-owner member from overwriting another member’s workspace connection', async () => {
    // buildWorkspaceWhere makes workspace rows writable workspace-wide; the
    // row-level gate must stop a plain member from clobbering another member's
    // Composio connection — before any remote account is created.
    connectorModelMock.findScopedByIdentifier.mockResolvedValueOnce({
      id: 'conn-other',
      identifier: 'gmail',
      userId: 'another-user',
    });

    await expect(
      composioRouter
        .createCaller({
          serverDB: {},
          userId: 'user_test',
          workspaceId: 'ws-1',
          workspaceRole: 'member',
        } as any)
        .createConnection({ appSlug: 'gmail', identifier: 'gmail', label: 'Gmail' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(connectorModelMock.create).not.toHaveBeenCalled();
  });
});
