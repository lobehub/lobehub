import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePrecreatedTopicSnapshot } from '../pipeline/precreatedTopic';

const { getInfoForAIGeneration, getPreference, isResourceAuthorOrAdmin } = vi.hoisted(() => ({
  getInfoForAIGeneration: vi.fn(),
  getPreference: vi.fn(),
  isResourceAuthorOrAdmin: vi.fn(),
}));

vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: class {
    getPreference = getPreference;
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { getInfoForAIGeneration },
}));

vi.mock('@/server/services/resourcePermission', () => ({
  isResourceAuthorOrAdmin,
}));

const agentRow = () =>
  ({
    agencyConfig: undefined,
    chatConfig: {},
    id: 'agent-a',
    model: 'gpt-4o',
    plugins: [],
    provider: 'openai',
    slug: 'agent-a',
    systemRole: '',
    userId: 'user-1',
    visibility: 'private',
  }) as never;

const deps = () => ({
  db: {} as never,
  resolveAgentConfigOrThrow: async () => agentRow(),
  userId: 'user-1',
});

// A topic can be written before `setupTurn` ever runs for it, and `setupTurn`
// only snapshots the topics it creates itself. Without this snapshot a
// pre-created row carries neither `model` nor `provider`, so it silently
// follows every later agent-default change instead of keeping the
// configuration it was created under.
describe('resolvePrecreatedTopicSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPreference.mockResolvedValue({});
    isResourceAuthorOrAdmin.mockResolvedValue(false);
    getInfoForAIGeneration.mockResolvedValue({ responseLanguage: 'en-US' });
  });

  it('pins the agent model and provider for the pre-created topic', async () => {
    const { snapshot } = await resolvePrecreatedTopicSnapshot(deps(), 'agent-a');

    expect(snapshot).toMatchObject({ model: 'gpt-4o', provider: 'openai' });
  });
});
