// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginModel } from '@/database/models/plugin';

import { pluginRouter } from '../plugin';

vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const pendingRow = (linkedByUserId: string) => ({
  customParams: {
    composio: {
      connectedAccountId: 'ca_1',
      linkedByUserId,
      redirectUrl: 'https://composio.example/link/abc',
      status: 'INITIATED',
    },
  },
  identifier: 'gmail',
});

/**
 * A pending hosted OAuth link is a live capability of whoever started it. The
 * generic plugin list is workspace-wide, so it must keep the link only for its
 * linker, like `composio.getComposioPlugins` does.
 */
describe('pluginRouter.getPlugins composio link redaction', () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PluginModel).mockImplementation(function () {
      return { query } as any;
    });
  });

  const list = (ctx: { userId: string; workspaceId?: string }) =>
    pluginRouter.createCaller(ctx as any).getPlugins();

  it("drops a teammate's pending link in a workspace", async () => {
    query.mockResolvedValue([pendingRow('user-2')]);

    const [row] = await list({ userId: 'user-1', workspaceId: 'ws-1' });

    expect(row.customParams?.composio).not.toHaveProperty('redirectUrl');
    // A teammate's private connection is never listed to the client
    expect(query).toHaveBeenCalledWith({ forClient: true });
    expect(row.customParams?.composio).toMatchObject({ connectedAccountId: 'ca_1' });
  });

  it('keeps the link for its linker', async () => {
    query.mockResolvedValue([pendingRow('user-1')]);

    const [row] = await list({ userId: 'user-1', workspaceId: 'ws-1' });

    expect(row.customParams?.composio?.redirectUrl).toBe('https://composio.example/link/abc');
  });

  it('keeps every link outside a workspace', async () => {
    query.mockResolvedValue([pendingRow('user-2')]);

    const [row] = await list({ userId: 'user-1' });

    expect(row.customParams?.composio?.redirectUrl).toBe('https://composio.example/link/abc');
  });
});
