// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';

import { connectorRouter } from '../connector';

// `vi.mock` is hoisted by vitest's transformer above all imports at runtime,
// so the relative import order doesn't matter functionally — the mocks below
// are still active when the router module is evaluated. They live below the
// imports to satisfy `import-x/first` without disabling the rule.
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
  return { wsCompatProcedure: mod.trpc.procedure };
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
    connectorModelMock.queryByIdentifiers.mockResolvedValueOnce([
      { id: 'conn-existing', identifier: 'legacy-mcp', sourceType: 'marketplace' },
    ]);

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
    connectorModelMock.queryByIdentifiers.mockResolvedValueOnce([
      { id: 'conn-existing', identifier: 'legacy-mcp', sourceType: 'custom' },
    ]);

    await caller().create(baseCustomInput);

    expect(connectorModelMock.update).toHaveBeenCalledWith(
      'conn-existing',
      expect.objectContaining({ sourceType: 'custom' }),
    );
  });

  it('still creates a fresh row when no existing identifier matches', async () => {
    connectorModelMock.queryByIdentifiers.mockResolvedValueOnce([]);

    const result = await caller().create(baseCustomInput);

    expect(result).toEqual({ id: 'conn-new' });
    expect(connectorModelMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'legacy-mcp', sourceType: 'custom' }),
    );
    expect(connectorModelMock.update).not.toHaveBeenCalled();
  });
});
