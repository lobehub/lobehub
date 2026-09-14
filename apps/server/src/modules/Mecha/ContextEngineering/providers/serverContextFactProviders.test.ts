import { describe, expect, it, vi } from 'vitest';

import { createServerContextFactProviders } from './index';

const { findById, getInfoForAIGeneration, loadConnectedComposioIds } = vi.hoisted(() => ({
  findById: vi.fn(),
  getInfoForAIGeneration: vi.fn(),
  loadConnectedComposioIds: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(
    class {
      getUserSettings = vi.fn();
    },
    { getInfoForAIGeneration },
  ),
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
