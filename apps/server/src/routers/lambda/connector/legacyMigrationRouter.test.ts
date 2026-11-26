// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorLinkModel } from '@/database/models/connectorLink';
import { PluginModel } from '@/database/models/plugin';

import { connectorRouter } from './index';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorLink', () => ({ ConnectorLinkModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/workspace', () => ({ WorkspaceModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: vi.fn() }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => trpc.middleware((opts) => opts.next()),
    wsCompatProcedure: trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    serverDatabase: trpc.middleware((opts) =>
      opts.next({ ctx: { ...opts.ctx, serverDB: {} as never } }),
    ),
  };
});

const models = vi.hoisted(() => ({
  connector: {
    createUnlessIdentifierHeld: vi.fn(),
    findScopedByIdentifier: vi.fn(),
    update: vi.fn(),
  },
  link: { listByConnectorIds: vi.fn() },
  plugin: { deleteOwned: vi.fn(), findById: vi.fn(), findOwnedById: vi.fn() },
}));

const legacyPlugin = {
  customParams: {
    mcp: {
      auth: { token: 'secret-token', type: 'bearer' },
      type: 'http',
      url: 'https://mcp.example.com',
    },
  },
  identifier: 'github-mcp',
  manifest: {
    api: [{ humanIntervention: 'always', name: 'send' }],
    meta: { title: 'GitHub' },
  },
  type: 'plugin',
  userId: 'user',
};

describe('connectorRouter.migrateLegacyPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return models.connector as never;
    });
    vi.mocked(ConnectorLinkModel).mockImplementation(function () {
      return models.link as never;
    });
    vi.mocked(PluginModel).mockImplementation(function () {
      return models.plugin as never;
    });
    models.plugin.findOwnedById.mockResolvedValue(legacyPlugin);
    models.plugin.findById.mockResolvedValue(legacyPlugin);
    models.link.listByConnectorIds.mockResolvedValue([]);
  });

  const caller = () => connectorRouter.createCaller({ userId: 'user' } as never);

  it('adopts the endpointless marketplace projection left by syncPluginTools', async () => {
    const projection = {
      agentId: null,
      credentials: null,
      id: 'existing-connector',
      mcpConnectionType: null,
      mcpServerUrl: null,
      metadata: {},
      sourceType: 'marketplace',
      userId: 'user',
      visibility: 'public',
    };
    models.connector.findScopedByIdentifier.mockResolvedValue(projection);
    models.connector.update.mockResolvedValue(projection);

    await expect(caller().migrateLegacyPlugin({ identifier: 'github-mcp' })).resolves.toEqual({
      id: 'existing-connector',
      isNew: false,
    });

    expect(models.connector.update).toHaveBeenCalledWith(
      'existing-connector',
      expect.objectContaining({
        credentials: JSON.stringify({ token: 'secret-token', type: 'bearer' }),
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com',
        mcpStdioConfig: null,
        metadata: expect.objectContaining({
          marketplaceInstalled: true,
          marketplaceToolPolicies: { send: 'always' },
          migratedFromLegacyPlugin: true,
        }),
        oidcConfig: null,
        sourceType: 'marketplace',
      }),
    );
    expect(models.connector.createUnlessIdentifierHeld).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an endpointless row that already holds an OAuth account', async () => {
    models.connector.findScopedByIdentifier.mockResolvedValue({
      agentId: null,
      credentials: null,
      id: 'existing-connector',
      mcpConnectionType: null,
      mcpServerUrl: null,
      metadata: {},
      sourceType: 'marketplace',
      userId: 'user',
      visibility: 'public',
    });
    models.link.listByConnectorIds.mockResolvedValue([{ id: 'lnk_default' }]);

    await expect(caller().migrateLegacyPlugin({ identifier: 'github-mcp' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(models.connector.update).not.toHaveBeenCalled();
  });

  it('still refuses to overwrite an independently configured connector', async () => {
    models.connector.findScopedByIdentifier.mockResolvedValue({
      agentId: null,
      credentials: null,
      id: 'existing-connector',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://other.example.com',
      metadata: {},
      sourceType: 'marketplace',
      userId: 'user',
      visibility: 'public',
    });

    await expect(caller().migrateLegacyPlugin({ identifier: 'github-mcp' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(models.connector.update).not.toHaveBeenCalled();
    expect(models.link.listByConnectorIds).not.toHaveBeenCalled();
  });

  it('refuses to copy a teammate’s same-named legacy installation', async () => {
    models.plugin.findOwnedById.mockResolvedValue(undefined);
    models.plugin.findById.mockResolvedValue({ ...legacyPlugin, userId: 'teammate' });

    await expect(caller().migrateLegacyPlugin({ identifier: 'github-mcp' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Only the member who installed this legacy plugin can migrate it',
    });
    expect(models.connector.update).not.toHaveBeenCalled();
  });

  it('removes only the caller’s legacy row after the replacement connector connects', async () => {
    models.connector.findScopedByIdentifier.mockImplementation(
      (_identifier, _agentId, _gateKeeper, visibility) =>
        visibility === 'public'
          ? {
              id: 'replacement',
              mcpConnectionType: 'http',
              mcpServerUrl: 'https://mcp.example.com',
              metadata: { migratedFromLegacyPlugin: true },
              status: 'connected',
            }
          : null,
    );

    await expect(
      caller().completeLegacyPluginMigration({ identifier: 'github-mcp' }),
    ).resolves.toEqual({ removed: true });
    expect(models.plugin.deleteOwned).toHaveBeenCalledWith('github-mcp');
  });

  it('keeps the legacy row until the replacement connector has synchronized', async () => {
    models.connector.findScopedByIdentifier.mockResolvedValue({
      id: 'replacement',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com',
      metadata: { migratedFromLegacyPlugin: true },
      status: 'disconnected',
    });

    await expect(
      caller().completeLegacyPluginMigration({ identifier: 'github-mcp' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(models.plugin.deleteOwned).not.toHaveBeenCalled();
  });

  it('keeps migration completion idempotent after the caller’s row is gone', async () => {
    models.plugin.findOwnedById.mockResolvedValue(undefined);
    models.connector.findScopedByIdentifier.mockImplementation(
      (_identifier, _agentId, _gateKeeper, visibility) =>
        visibility === 'public'
          ? {
              id: 'replacement',
              mcpConnectionType: 'http',
              mcpServerUrl: 'https://mcp.example.com',
              metadata: { migratedFromLegacyPlugin: true },
              status: 'connected',
            }
          : null,
    );

    await expect(
      caller().completeLegacyPluginMigration({ identifier: 'github-mcp' }),
    ).resolves.toEqual({ removed: false });
    expect(models.plugin.deleteOwned).not.toHaveBeenCalled();
  });
});
