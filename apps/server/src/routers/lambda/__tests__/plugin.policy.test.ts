// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginModel } from '@/database/models/plugin';

import { pluginRouter } from '../plugin';

vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: trpc.procedure };
});
vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const { trpc } = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { withScopedPermission: () => trpc.middleware(async (opts: any) => opts.next()) };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next(),
}));

const settings = vi.hoisted(() => ({ loadTenantSettings: vi.fn() }));
vi.mock('@lobechat/business-config/tenant-settings', () => ({
  loadTenantSettings: settings.loadTenantSettings,
}));

const policy = (overrides = {}) => ({
  connectorPolicy: { allowCustomConnectors: true, allowlist: [], blocklist: [], ...overrides },
});

// Legacy plugin rows are the other way to add an MCP: `customPlugin` is member
// defined, `plugin` is a marketplace install. Both follow the connector policy.
describe('pluginRouter under the tenant connector policy', () => {
  const plugin = { create: vi.fn(), findById: vi.fn(), update: vi.fn() };
  const caller = () => pluginRouter.createCaller({ serverDB: {}, userId: 'member' } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PluginModel).mockImplementation(function () {
      return plugin as any;
    });
    plugin.findById.mockResolvedValue(undefined);
    plugin.create.mockResolvedValue({ identifier: 'created' });
  });

  it('refuses a custom MCP plugin when members may not add their own connectors', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ allowCustomConnectors: false }));
    const input = {
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
      identifier: 'my-mcp',
      manifest: {},
      type: 'customPlugin' as const,
    };
    await expect(caller().createOrInstallPlugin(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller().createPlugin(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(plugin.create).not.toHaveBeenCalled();
  });

  it('refuses installing a blocklisted or non-allowlisted marketplace MCP', async () => {
    settings.loadTenantSettings.mockResolvedValue(
      policy({ allowlist: ['team-docs'], blocklist: ['shady-mcp'] }),
    );
    for (const identifier of ['shady-mcp', 'github'])
      await expect(
        caller().createOrInstallPlugin({ identifier, manifest: {}, type: 'plugin' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(plugin.create).not.toHaveBeenCalled();

    await expect(
      caller().createOrInstallPlugin({ identifier: 'team-docs', manifest: {}, type: 'plugin' }),
    ).resolves.toBe('created');
  });

  it('refuses updating an existing custom plugin when custom connectors are off', async () => {
    settings.loadTenantSettings.mockResolvedValue(policy({ allowCustomConnectors: false }));
    plugin.findById.mockResolvedValue({ type: 'customPlugin', userId: 'member' });
    await expect(caller().updatePlugin({ id: 'my-mcp', settings: {} })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(plugin.update).not.toHaveBeenCalled();
  });
});
