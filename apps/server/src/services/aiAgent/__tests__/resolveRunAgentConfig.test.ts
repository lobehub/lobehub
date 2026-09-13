import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRunAgentConfig } from '../pipeline/resolveRunAgentConfig';

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

const deps = {
  db: {} as never,
  userId: 'member-1',
  workspaceId: 'ws-1',
};

const webOnboardingRow = () =>
  ({
    agencyConfig: undefined,
    chatConfig: {},
    id: 'agent-web-onboarding',
    model: 'gpt-4',
    plugins: [],
    provider: 'openai',
    slug: 'web-onboarding',
    systemRole: '',
    userId: 'author-1',
    visibility: 'public',
    workspaceId: 'ws-1',
  }) as never;

describe('resolveRunAgentConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPreference.mockResolvedValue({});
    isResourceAuthorOrAdmin.mockResolvedValue(false);
    getInfoForAIGeneration.mockResolvedValue({ responseLanguage: 'en-US' });
  });

  it('keeps a builtin runtime execution target over a saved member device override', async () => {
    // A workspace member pinned this agent to their local device …
    getPreference.mockResolvedValue({
      agentDeviceOverrides: {
        'agent-web-onboarding': { boundDeviceId: 'dev-1', executionTarget: 'local' },
      },
    });

    const { agentConfig } = await resolveRunAgentConfig(
      { ...deps, resolveAgentConfigOrThrow: async () => webOnboardingRow() },
      { identifier: 'agent-web-onboarding', throwIfExecutionAborted: async () => {} },
    );

    // … but the onboarding runtime disables execution outright, and the
    // runtime policy is merged on top of the member preference, not under it.
    expect(agentConfig.agencyConfig?.executionTarget).toBe('none');
  });

  it('applies a saved member device override to a regular workspace agent', async () => {
    getPreference.mockResolvedValue({
      agentDeviceOverrides: {
        'agent-regular': { boundDeviceId: 'dev-1', executionTarget: 'local' },
      },
    });

    const { agentConfig, memberDeviceOverride } = await resolveRunAgentConfig(
      {
        ...deps,
        resolveAgentConfigOrThrow: async () =>
          ({ ...(webOnboardingRow() as object), id: 'agent-regular', slug: null }) as never,
      },
      { identifier: 'agent-regular', throwIfExecutionAborted: async () => {} },
    );

    expect(memberDeviceOverride).toEqual({ boundDeviceId: 'dev-1', executionTarget: 'local' });
    expect(agentConfig.agencyConfig?.executionTarget).toBe('local');
  });
});
