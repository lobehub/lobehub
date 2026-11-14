// @vitest-environment node
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginModel } from '@/database/models/plugin';

import { pluginRouter } from '../plugin';

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

const call = (path: string, input: unknown) =>
  fetchRequestHandler({
    createContext: () => ({ userId: 'user-1' }) as never,
    endpoint: '/trpc/lambda/plugin',
    req: new Request(`http://localhost/trpc/lambda/plugin/${path}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    router: pluginRouter,
  });

/**
 * New MCP installs only write `user_connectors`. The 1.0 create routes are
 * gone, so nothing can add a `user_installed_plugins` row any more.
 */
describe('pluginRouter without the legacy create routes', () => {
  const pluginModel = {
    create: vi.fn(),
    findById: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PluginModel).mockImplementation(function () {
      return pluginModel as any;
    });
  });

  it.each(['createPlugin', 'createOrInstallPlugin'])(
    'answers %s with NOT_FOUND and writes no plugin row',
    async (path) => {
      const res = await call(path, {
        customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
        identifier: 'box',
        manifest: { api: [], identifier: 'box' },
        type: 'plugin',
      });

      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).toContain('NOT_FOUND');
      expect(pluginModel.create).not.toHaveBeenCalled();
      expect(pluginModel.update).not.toHaveBeenCalled();
    },
  );

  it('keeps only the read and maintenance procedures', () => {
    expect(Object.keys(pluginRouter._def.procedures).sort()).toEqual([
      'getPlugins',
      'removePlugin',
      'updatePlugin',
    ]);
  });
});
