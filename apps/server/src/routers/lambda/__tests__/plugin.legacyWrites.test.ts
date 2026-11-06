import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { describe, expect, it, vi } from 'vitest';

import { pluginRouter } from '../plugin';

const pluginModel = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  update: vi.fn(),
}));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(function PluginModel() {
    return pluginModel;
  }),
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

describe('legacy plugin write entry points', () => {
  it.each(['createPlugin', 'createOrInstallPlugin'])(
    'rejects %s without writing a user_installed_plugins row',
    async (path) => {
      const res = await call(path, {
        customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
        identifier: 'box',
        manifest: { api: [], identifier: 'box' },
        type: 'plugin',
      });

      expect(res.status).toBe(412);
      const body = JSON.stringify(await res.json());
      expect(body).toContain('PRECONDITION_FAILED');
      expect(body).toContain('add MCP servers as connectors');
      expect(pluginModel.create).not.toHaveBeenCalled();
      expect(pluginModel.update).not.toHaveBeenCalled();
    },
  );

  it('keeps only the read and maintenance procedures besides the retired stubs', () => {
    expect(Object.keys(pluginRouter._def.procedures).sort()).toEqual([
      'createOrInstallPlugin',
      'createPlugin',
      'getPlugins',
      'removePlugin',
      'updatePlugin',
    ]);
  });
});
