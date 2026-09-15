import { defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import { describe, expect, it, vi } from 'vitest';

import { createServerContextFactProviders } from './index';

const { findById, getInfoForAIGeneration, getUserSettings, loadConnectedComposioIds, pluginQuery } =
  vi.hoisted(() => ({
    findById: vi.fn(),
    getInfoForAIGeneration: vi.fn(),
    getUserSettings: vi.fn(),
    loadConnectedComposioIds: vi.fn(),
    pluginQuery: vi.fn(),
  }));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(
    class {
      getUserSettings = getUserSettings;
    },
    { getInfoForAIGeneration },
  ),
}));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: class {
    query = pluginQuery;
  },
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: class {
    findById = findById;
  },
}));
vi.mock('@/server/modules/AgentRuntime/adapters/composioConnectedIds', () => ({
  loadConnectedComposioIds,
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.test' } }));

const source = (state: Record<string, unknown> = {}) => ({
  ctx: { serverDB: {}, userId: 'owner-1', workspaceId: 'ws-1' } as never,
  state: state as never,
});

describe('createServerContextFactProviders', () => {
  it('answers nothing without a database or user', () => {
    expect(createServerContextFactProviders({ ctx: {} as never, state: {} as never })).toEqual({});
  });

  it('reads user info for the user the rules name, defaulting to the run owner', async () => {
    getInfoForAIGeneration.mockResolvedValue({ responseLanguage: 'ja-JP', userName: 'v' });
    const providers = createServerContextFactProviders(source());

    await expect(providers.getUserInfo!('visitor-1')).resolves.toEqual({
      language: 'ja-JP',
      username: 'v',
    });
    expect(getInfoForAIGeneration).toHaveBeenLastCalledWith(expect.anything(), 'visitor-1');

    await providers.getUserInfo!(undefined);
    expect(getInfoForAIGeneration).toHaveBeenLastCalledWith(expect.anything(), 'owner-1');
  });

  it('unions connected Composio services with the run’s LobeHub skill providers', async () => {
    loadConnectedComposioIds.mockResolvedValue(new Set(['gmail']));
    const providers = createServerContextFactProviders(
      source({
        operationToolSet: {
          sourceMap: {
            'gmail': 'composio',
            'lobehub-skill-x': 'lobehubSkill',
            'weather': 'builtin',
          },
        },
      }),
    );

    const ids = new Set(await providers.listConnectedConnectorIds!('agt_1'));
    expect(ids).toEqual(new Set(['gmail', 'lobehub-skill-x']));
  });

  it('offers every installed custom MCP connector, pinned or not, and nothing else', async () => {
    pluginQuery.mockResolvedValue([
      {
        identifier: 'my-mcp',
        manifest: { meta: { description: 'Local files', title: 'My MCP' } },
        type: 'customPlugin',
      },
      { identifier: 'market-plugin', manifest: { meta: { title: 'Market' } }, type: 'plugin' },
    ]);

    await expect(
      createServerContextFactProviders(source({ operationToolSet: { sourceMap: {} } }))
        .listCustomPlugins!(),
    ).resolves.toEqual([
      { description: 'Local files', identifier: 'my-mcp', name: 'My MCP', type: 'custom' },
    ]);
  });

  it('reads the uninstalled builtin list from the scope the run belongs to', async () => {
    getUserSettings.mockResolvedValue({
      tool: {
        uninstalledBuiltinTools: ['lobe-personal-gone'],
        uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['lobe-ws-gone'] },
      },
    });

    await expect(
      createServerContextFactProviders(source({ origin: { workspaceId: 'ws-1' } }))
        .listUninstalledBuiltinIds!(),
    ).resolves.toEqual(['lobe-ws-gone']);
    await expect(
      createServerContextFactProviders({
        ctx: { serverDB: {}, userId: 'owner-1' } as never,
        state: {} as never,
      }).listUninstalledBuiltinIds!(),
    ).resolves.toEqual(['lobe-personal-gone']);
  });

  it('falls back to the default uninstalled seed when the scope was never configured', async () => {
    getUserSettings.mockResolvedValue({
      tool: { uninstalledBuiltinTools: ['lobe-personal-gone'] },
    });

    // A workspace without its own slot gets the seed, never the personal list.
    await expect(
      createServerContextFactProviders(source({ origin: { workspaceId: 'ws-new' } }))
        .listUninstalledBuiltinIds!(),
    ).resolves.toEqual(defaultUninstalledBuiltinTools);

    getUserSettings.mockResolvedValue({});
    await expect(
      createServerContextFactProviders({
        ctx: { serverDB: {}, userId: 'owner-1' } as never,
        state: {} as never,
      }).listUninstalledBuiltinIds!(),
    ).resolves.toEqual(defaultUninstalledBuiltinTools);
    expect(defaultUninstalledBuiltinTools.length).toBeGreaterThan(0);
  });

  it('returns the app origin and the workspace slug when it resolves', async () => {
    findById.mockResolvedValue({ slug: 'team' });
    const providers = createServerContextFactProviders(source());

    await expect(providers.getWorkspaceContext!(undefined)).resolves.toEqual({
      appUrl: 'https://app.test',
    });
    await expect(providers.getWorkspaceContext!('ws-1')).resolves.toEqual({
      appUrl: 'https://app.test',
      slug: 'team',
    });
    findById.mockResolvedValue({ slug: null });
    await expect(providers.getWorkspaceContext!('ws-1')).resolves.toEqual({
      appUrl: 'https://app.test',
      slug: undefined,
    });
  });
});
