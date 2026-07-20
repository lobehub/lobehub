// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';

import { connectorRouter } from '../connector';

// `vi.mock` is hoisted by vitest's transformer above all imports at runtime,
// so the relative import order doesn't matter functionally — the mocks below
// are still active when the router module is evaluated. They live below the
// imports to satisfy `import-x/first` without disabling the rule.
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  // The real `wsCompatProcedure` validates a Better-Auth session; for unit
  // tests we skip auth and rely on the test ctx already carrying `userId`.
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

describe('connectorRouter.syncPluginTools — customPlugin guard', () => {
  let connectorModelMock: any;
  let connectorToolModelMock: any;
  let pluginModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    connectorModelMock = {
      create: vi.fn().mockResolvedValue({ id: 'conn-new' }),
      queryByIdentifiers: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    };
    connectorToolModelMock = { upsertMany: vi.fn() };
    pluginModelMock = { findById: vi.fn() };

    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => connectorToolModelMock);
    vi.mocked(PluginModel).mockImplementation(() => pluginModelMock);
  });

  const callerFor = (workspaceId?: string) =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: workspaceId ?? null,
    } as any);

  it('returns { connectorId: null } early for customPlugin rows that own an MCP endpoint', async () => {
    // This is the load-bearing guard: legacy custom MCP plugins MUST go through
    // the frontend `CustomConnectorModal` migration path, not this procedure —
    // otherwise we leak a half-baked marketplace connector row that the runtime
    // filter then discards, leaving the agent with no working tools.
    pluginModelMock.findById.mockResolvedValueOnce({
      type: 'customPlugin',
      manifest: { meta: { title: 'Legacy MCP' } },
      customParams: { mcp: { type: 'http', url: 'http://10.9.16.224:9100/mcp' } },
    });

    const result = await callerFor().syncPluginTools({ identifier: 'dockpit' });

    expect(result).toEqual({ connectorId: null, toolCount: 0 });
    expect(connectorModelMock.create).not.toHaveBeenCalled();
    expect(connectorToolModelMock.upsertMany).not.toHaveBeenCalled();
  });

  it('still bootstraps a connector row for marketplace plugins (the original happy path)', async () => {
    // Same plugin row shape but type='plugin' — the marketplace case the
    // procedure was originally written for. The customPlugin guard must NOT
    // affect this branch.
    pluginModelMock.findById.mockResolvedValueOnce({
      type: 'plugin',
      manifest: {
        api: [
          {
            description: 'Search the web',
            humanIntervention: 'never',
            name: 'web_search',
            parameters: { properties: { q: { type: 'string' } }, type: 'object' },
          },
        ],
        meta: { avatar: '🔎', description: 'Web search', title: 'WebSearch' },
      },
    });

    const result = await callerFor().syncPluginTools({ identifier: 'web-search' });

    expect(result.connectorId).toBe('conn-new');
    expect(result.toolCount).toBe(1);
    expect(connectorModelMock.create).toHaveBeenCalledTimes(1);
    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(
      'conn-new',
      expect.arrayContaining([expect.objectContaining({ toolName: 'web_search' })]),
    );
  });

  it('also defers when plugin has type=customPlugin AND has a manifest (no half-baked row written)', async () => {
    // Some legacy customPlugin rows DO have a manifest (cached from a successful
    // tools/list call earlier). The guard must not fall through just because a
    // manifest exists — the discriminator is `type === 'customPlugin'` + mcp.
    pluginModelMock.findById.mockResolvedValueOnce({
      type: 'customPlugin',
      manifest: { api: [{ name: 'cached_tool' }], meta: { title: 'X' } },
      customParams: { mcp: { type: 'stdio', command: '/bin/x' } },
    });

    const result = await callerFor().syncPluginTools({ identifier: 'x' });

    expect(result).toEqual({ connectorId: null, toolCount: 0 });
    expect(connectorModelMock.create).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the plugin row does not exist (unchanged behavior)', async () => {
    pluginModelMock.findById.mockResolvedValueOnce(null);
    await expect(callerFor().syncPluginTools({ identifier: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('defers (not NOT_FOUND) for customPlugin+mcp rows whose manifest is NULL', async () => {
    // This is the exact #15674 victim profile: legacy custom MCP whose
    // `tools/list` never succeeded after the v2.2.3 break, so `manifest` is
    // NULL on the row. The customPlugin migration guard MUST run before the
    // manifest check, otherwise the user gets a NOT_FOUND, the SkillDetail
    // fallback never renders, and the migration modal never surfaces.
    pluginModelMock.findById.mockResolvedValueOnce({
      type: 'customPlugin',
      manifest: null,
      customParams: { mcp: { type: 'http', url: 'http://10.9.16.224:9100/mcp' } },
    });

    const result = await callerFor().syncPluginTools({ identifier: 'dockpit' });

    expect(result).toEqual({ connectorId: null, toolCount: 0 });
    expect(connectorModelMock.create).not.toHaveBeenCalled();
  });

  it('still throws NOT_FOUND for non-customPlugin rows with no manifest', async () => {
    // Marketplace rows are expected to always carry a manifest. If a plugin
    // row exists but its manifest is missing AND it isn't a customPlugin with
    // an MCP blob to migrate, we can't bootstrap a connector from it — the
    // NOT_FOUND signal stays as it was for that genuinely broken case.
    pluginModelMock.findById.mockResolvedValueOnce({
      type: 'plugin',
      manifest: null,
    });
    await expect(
      callerFor().syncPluginTools({ identifier: 'broken-marketplace' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('connectorRouter.create — sourceType handling on existing rows', () => {
  // Companion to the syncPluginTools guard above. The legacy customPlugin →
  // connector migration relies on `connector.create` being idempotent on
  // (user_id, identifier); the existing-row branch must also accept the
  // `sourceType` from the input so a half-baked `marketplace` connector row
  // (left behind by the pre-guard `syncPluginTools` code path) gets promoted
  // to `custom`. Without the promotion the row stays invisible to the custom-
  // connector list selectors and the migrated MCP disappears from the UI.

  let connectorModelMock: any;
  let pluginModelMock: any;
  let connectorToolModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    connectorModelMock = {
      create: vi.fn().mockResolvedValue({ id: 'conn-new' }),
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      queryByIdentifiers: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    };
    connectorToolModelMock = { upsertMany: vi.fn() };
    pluginModelMock = { findById: vi.fn() };
    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => connectorToolModelMock);
    vi.mocked(PluginModel).mockImplementation(() => pluginModelMock);
  });

  const caller = () =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: null,
    } as any);

  const baseCustomInput = {
    identifier: 'legacy-mcp',
    isEnabled: true,
    mcpConnectionType: 'http' as const,
    mcpServerUrl: 'https://mcp.example.com',
    name: 'Legacy MCP',
    sourceType: 'custom' as const,
  };

  it('promotes an existing marketplace row to custom when the input asks for it', async () => {
    // Pre-existing half-baked row from the old syncPluginTools code path.
    connectorModelMock.findScopedByIdentifier.mockResolvedValueOnce({
      id: 'conn-existing',
      identifier: 'legacy-mcp',
      sourceType: 'marketplace',
    });

    const result = await caller().create(baseCustomInput);

    expect(result).toEqual({ id: 'conn-existing' });
    expect(connectorModelMock.create).not.toHaveBeenCalled();
    expect(connectorModelMock.update).toHaveBeenCalledTimes(1);
    expect(connectorModelMock.update).toHaveBeenCalledWith(
      'conn-existing',
      expect.objectContaining({ sourceType: 'custom' }),
    );
  });

  it('keeps sourceType consistent when the input and existing row agree', async () => {
    // A normal re-save / re-authorize of an already-custom connector — the
    // update still includes sourceType, but the value stays the same. This
    // documents that the promotion path is safe for the no-op case.
    connectorModelMock.findScopedByIdentifier.mockResolvedValueOnce({
      id: 'conn-existing',
      identifier: 'legacy-mcp',
      sourceType: 'custom',
    });

    await caller().create(baseCustomInput);

    expect(connectorModelMock.update).toHaveBeenCalledWith(
      'conn-existing',
      expect.objectContaining({ sourceType: 'custom' }),
    );
  });

  it('still creates a fresh row when no existing identifier matches', async () => {
    connectorModelMock.findScopedByIdentifier.mockResolvedValueOnce(null);

    const result = await caller().create(baseCustomInput);

    expect(result).toEqual({ id: 'conn-new' });
    expect(connectorModelMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'legacy-mcp', sourceType: 'custom' }),
    );
    expect(connectorModelMock.update).not.toHaveBeenCalled();
  });
});

describe('connectorRouter.delete — agent connector unpins from the owning agent (LOBE-11682)', () => {
  // Deleting an agent-owned connector must also remove its tool from that
  // agent's `plugins`, so the unified settings delete matches the agent-profile
  // delete (row + pin) and never leaves a dangling pin. Done server-side so the
  // unified page needs no access to an arbitrary agent's config.
  let connectorModelMock: any;
  let agentModelMock: any;

  const DELETE_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
    connectorModelMock = {
      delete: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn(),
    };
    agentModelMock = {
      getAgentConfigById: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => ({}) as any);
    vi.mocked(PluginModel).mockImplementation(() => ({}) as any);
    vi.mocked(AgentModel).mockImplementation(() => agentModelMock);
  });

  const caller = () =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: null,
    } as any);

  it('deletes the row and strips the identifier from the owning agent plugins', async () => {
    connectorModelMock.findById.mockResolvedValueOnce({
      agentId: 'agent-1',
      id: 'c1',
      identifier: 'gmail',
      userId: 'user_test',
    });
    agentModelMock.getAgentConfigById.mockResolvedValueOnce({ plugins: ['gmail', 'notion'] });

    await caller().delete({ id: DELETE_ID });

    expect(connectorModelMock.delete).toHaveBeenCalledWith(DELETE_ID);
    expect(agentModelMock.getAgentConfigById).toHaveBeenCalledWith('agent-1');
    // 'gmail' removed, 'notion' preserved.
    expect(agentModelMock.update).toHaveBeenCalledWith('agent-1', { plugins: ['notion'] });
  });

  it('leaves the agent config untouched for a base (non-agent) connector', async () => {
    connectorModelMock.findById.mockResolvedValueOnce({
      agentId: null,
      id: 'c2',
      identifier: 'notion',
      userId: 'user_test',
    });

    await caller().delete({ id: DELETE_ID });

    expect(connectorModelMock.delete).toHaveBeenCalledWith(DELETE_ID);
    expect(agentModelMock.getAgentConfigById).not.toHaveBeenCalled();
    expect(agentModelMock.update).not.toHaveBeenCalled();
  });

  it('is a no-op on the agent when the connector row is already gone', async () => {
    connectorModelMock.findById.mockResolvedValueOnce(null);

    await caller().delete({ id: DELETE_ID });

    expect(connectorModelMock.delete).not.toHaveBeenCalled();
    expect(agentModelMock.update).not.toHaveBeenCalled();
  });
});

describe('connectorRouter.listAgentBound — hides connectors of unseen agents (LOBE-11681)', () => {
  // `queryAllAgentScoped` filters only by `workspace_id`, so a member could
  // otherwise see connectors owned by another member's PRIVATE agent. Gate the
  // result on the visibility-aware agent set (`getAgentAvatarsByIds`).
  let connectorModelMock: any;
  let connectorToolModelMock: any;
  let agentModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    connectorModelMock = { queryAllAgentScoped: vi.fn() };
    connectorToolModelMock = { queryByConnector: vi.fn().mockResolvedValue([]) };
    agentModelMock = { getAgentAvatarsByIds: vi.fn() };
    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => connectorToolModelMock);
    vi.mocked(PluginModel).mockImplementation(() => ({}) as any);
    vi.mocked(AgentModel).mockImplementation(() => agentModelMock);
  });

  const caller = () =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: 'ws-1',
    } as any);

  it('drops rows whose owning agent is not in the visible set', async () => {
    connectorModelMock.queryAllAgentScoped.mockResolvedValueOnce([
      {
        agentId: 'agent-visible',
        credentials: null,
        id: 'c-visible',
        identifier: 'gmail',
        oidcConfig: null,
      },
      {
        agentId: 'agent-private',
        credentials: null,
        id: 'c-private',
        identifier: 'notion',
        oidcConfig: null,
      },
    ]);
    // AgentModel.ownership() (visibility-aware) only returns the visible agent —
    // the other member's private agent is absent.
    agentModelMock.getAgentAvatarsByIds.mockResolvedValueOnce([
      { avatar: null, id: 'agent-visible', title: 'Visible Agent' },
    ]);

    const result = await caller().listAgentBound();

    expect(result.map((r: any) => r.id)).toEqual(['c-visible']);
    expect(result[0].agentTitle).toBe('Visible Agent');
  });
});
