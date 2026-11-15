// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginModel } from '@/database/models/plugin';

import { toClientVersionLabel } from '../_helpers/legacyPluginWriteMetrics';
import { pluginRouter } from '../plugin';

const counter = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@lobechat/observability-otel/modules/legacy-plugin-write', () => ({
  legacyPluginWriteCounter: counter,
}));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  // The real `wsCompatProcedure` validates a Better-Auth session; unit tests
  // skip auth and rely on the test ctx already carrying `userId`.
  return { wsCompatProcedure: mod.trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

/**
 * Released clients still install MCPs through these two routes, so until the
 * routes are removed they must keep writing `user_installed_plugins` rows
 * exactly as before, and every call must be counted.
 */
describe('pluginRouter legacy create routes', () => {
  let pluginModel: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  const caller = () =>
    pluginRouter.createCaller({
      clientMetadata: { type: 'desktop', version: '2.1.4' },
      userId: 'user-1',
    } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    pluginModel = {
      create: vi.fn(async (row: { identifier: string }) => ({ identifier: row.identifier })),
      findById: vi.fn().mockResolvedValue(undefined),
      update: vi.fn(),
    };
    vi.mocked(PluginModel).mockImplementation(function () {
      return pluginModel as any;
    });
  });

  it('createOrInstallPlugin still creates a plugin row and counts the call', async () => {
    const manifest = { api: [], identifier: 'box' };

    const result = await caller().createOrInstallPlugin({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
      identifier: 'box',
      manifest,
      settings: { token: 'x' },
      type: 'plugin',
    });

    expect(result).toBe('box');
    expect(pluginModel.create).toHaveBeenCalledWith({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
      identifier: 'box',
      manifest,
      settings: { token: 'x' },
      type: 'plugin',
    });
    expect(counter.add).toHaveBeenCalledWith(1, {
      client_type: 'desktop',
      client_version: toClientVersionLabel('2.1.4'),
      plugin_type: 'plugin',
      procedure: 'createOrInstallPlugin',
    });
  });

  it('createOrInstallPlugin still only refreshes the manifest of an existing row', async () => {
    pluginModel.findById.mockResolvedValue({ identifier: 'box', userId: 'user-1' });
    const manifest = { api: [{ name: 'search' }], identifier: 'box' };

    const result = await caller().createOrInstallPlugin({
      identifier: 'box',
      manifest,
      type: 'plugin',
    });

    expect(result).toBeUndefined();
    expect(pluginModel.create).not.toHaveBeenCalled();
    expect(pluginModel.update).toHaveBeenCalledWith('box', { manifest });
    expect(counter.add).toHaveBeenCalledTimes(1);
  });

  it('createPlugin still creates a custom plugin row and counts the call', async () => {
    const result = await caller().createPlugin({
      customParams: { mcp: { command: 'npx', type: 'stdio' } },
      identifier: 'my-mcp',
      type: 'customPlugin',
    });

    expect(result).toBe('my-mcp');
    expect(pluginModel.create).toHaveBeenCalledWith({
      customParams: { mcp: { command: 'npx', type: 'stdio' } },
      identifier: 'my-mcp',
      manifest: undefined,
      type: 'customPlugin',
    });
    expect(counter.add).toHaveBeenCalledWith(1, {
      client_type: 'desktop',
      client_version: toClientVersionLabel('2.1.4'),
      plugin_type: 'customPlugin',
      procedure: 'createPlugin',
    });
  });
});
