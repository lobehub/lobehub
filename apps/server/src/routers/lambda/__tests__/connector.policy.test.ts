// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { connectorRouter } from '../connector';

// See connector.syncToolsFromClientById.test.ts: the hoisted mocks replace the
// models and the auth middlewares so only the router's own checks run.
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
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
  telemetry: async (opts: any) => opts.next(),
}));

const settings = vi.hoisted(() => ({ loadTenantSettings: vi.fn() }));
vi.mock('@lobechat/business-config/tenant-settings', () => ({
  loadTenantSettings: settings.loadTenantSettings,
}));

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000002';
const policy = (overrides = {}) => ({
  connectorPolicy: { allowCustomConnectors: true, allowlist: [], blocklist: [], ...overrides },
});

// The tenant's connector policy (Admin `frontend_connector_policy`) is enforced
// by the server: a client that skips the hidden UI entry is still refused.
describe('connectorRouter under the tenant connector policy', () => {
  let connectorModel: any;

  beforeEach(() => {
    vi.clearAllMocks();
    connectorModel = {
      create: vi.fn().mockResolvedValue({ id: CONNECTOR_ID }),
      findById: vi.fn(),
      findScopedByIdentifier: vi.fn().mockResolvedValue(undefined),
      update: vi.fn(),
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModel;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return { upsertMany: vi.fn() } as any;
    });
  });

  const caller = () => connectorRouter.createCaller({ serverDB: {}, userId: 'member' } as any);
  const custom = {
    identifier: 'k3j2h1',
    mcpConnectionType: 'http' as const,
    mcpServerUrl: 'https://mcp.example.com/mcp',
    name: 'My MCP',
    sourceType: 'custom' as const,
  };

  it('refuses a direct create of a custom connector when members may not add their own', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ allowCustomConnectors: false }));
    await expect(caller().create(custom)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(connectorModel.create).not.toHaveBeenCalled();
    expect(connectorModel.update).not.toHaveBeenCalled();
  });

  it('refuses a blocklisted marketplace connector', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ blocklist: ['shady-mcp'] }));
    await expect(
      caller().create({ ...custom, identifier: 'shady-mcp', sourceType: 'marketplace' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(connectorModel.create).not.toHaveBeenCalled();
  });

  it('refuses a marketplace connector outside the allowlist and accepts one on it', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ allowlist: ['team-docs'] }));
    await expect(
      caller().create({ ...custom, identifier: 'github', sourceType: 'marketplace' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(connectorModel.create).not.toHaveBeenCalled();

    await expect(
      caller().create({ ...custom, identifier: 'team-docs', sourceType: 'marketplace' }),
    ).resolves.toEqual({ id: CONNECTOR_ID, isNew: true });
  });

  it('still creates custom connectors when the tenant allows them', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ allowlist: ['team-docs'] }));
    await expect(caller().create(custom)).resolves.toEqual({ id: CONNECTOR_ID, isNew: true });
  });

  it('refuses editing or authorizing an existing custom connector, but lets it be turned off', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ allowCustomConnectors: false }));
    connectorModel.findById.mockResolvedValue({
      id: CONNECTOR_ID,
      identifier: 'k3j2h1',
      mcpServerUrl: 'https://mcp.example.com/mcp',
      sourceType: 'custom',
      userId: 'member',
    });

    await expect(
      caller().update({ id: CONNECTOR_ID, patch: { mcpServerUrl: 'https://evil.example.com' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller().startOAuth({ id: CONNECTOR_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(connectorModel.update).not.toHaveBeenCalled();

    await caller().update({ id: CONNECTOR_ID, patch: { isEnabled: false } });
    expect(connectorModel.update).toHaveBeenCalledWith(
      CONNECTOR_ID,
      expect.objectContaining({ isEnabled: false }),
    );
  });

  it('refuses reporting tools into a custom connector when custom connectors are off', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ allowCustomConnectors: false }));
    await expect(
      caller().syncToolsFromClient({
        identifier: 'k3j2h1',
        name: 'My MCP',
        sourceType: 'custom',
        tools: [],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(connectorModel.create).not.toHaveBeenCalled();
  });
});
