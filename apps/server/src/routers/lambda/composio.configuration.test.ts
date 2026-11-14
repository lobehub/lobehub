// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginModel } from '@/database/models/plugin';

import { composioRouter } from './composio';

const mocks = vi.hoisted(() => ({
  pluginCreate: vi.fn(),
  pluginQuery: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return { create: mocks.pluginCreate, query: mocks.pluginQuery };
  }),
}));

// Keep the real Composio client factory and its missing-key guard. No SDK client
// or remote request can be created without a configured key.
vi.mock('@/config/composio', () => ({
  getServerComposioApiKey: () => undefined,
  getServerComposioAuthConfigId: () => undefined,
}));

const callerFor = (userId?: string, workspaceId?: string) =>
  composioRouter.createCaller({ userId, workspaceId } as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('composioRouter without a configured API key', () => {
  it.each([
    ['personal-user', undefined],
    ['workspace-user', 'workspace-1'],
  ])('lists stored Composio plugins for %s in the existing scope', async (userId, workspaceId) => {
    const composioPlugin = {
      customParams: { composio: { connectedAccountId: 'account-1' } },
      identifier: 'gmail',
    };
    mocks.pluginQuery.mockResolvedValue([
      composioPlugin,
      { customParams: {}, identifier: 'ordinary-plugin' },
      { identifier: 'another-plugin' },
    ]);

    await expect(callerFor(userId, workspaceId).getComposioPlugins()).resolves.toEqual([
      composioPlugin,
    ]);
    expect(PluginModel).toHaveBeenCalledWith(expect.anything(), userId, workspaceId);
  });

  it('still rejects unauthenticated plugin listing before reading the database', async () => {
    await expect(callerFor().getComposioPlugins()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.pluginQuery).not.toHaveBeenCalled();
  });

  it('still requires a key for remote account lookup', async () => {
    await expect(
      callerFor('user-1').getConnection({ connectedAccountId: 'account-1' }),
    ).rejects.toThrow('Composio API key is not configured on server');
  });

  it('still requires a key before creating a connection or writing its plugin', async () => {
    await expect(
      callerFor('user-1').createConnection({
        appSlug: 'gmail',
        identifier: 'gmail',
        label: 'Gmail',
      }),
    ).rejects.toThrow('Composio API key is not configured on server');
    expect(mocks.pluginCreate).not.toHaveBeenCalled();
  });
});
