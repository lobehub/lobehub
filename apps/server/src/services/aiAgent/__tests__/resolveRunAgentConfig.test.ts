import { buildHeteroExecArgs } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfigWithId } from '@/server/services/agent';

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

  it('reads the reply language for the share visitor, not the owner, on a shared-agent run', async () => {
    getInfoForAIGeneration.mockImplementation(async (_db: unknown, userId: string) => ({
      responseLanguage: userId === 'visitor-1' ? 'ja-JP' : 'en-US',
    }));

    const { agentConfig } = await resolveRunAgentConfig(
      {
        ...deps,
        resolveAgentConfigOrThrow: async () =>
          ({ ...(webOnboardingRow() as object), id: 'agent-regular', slug: null }) as never,
      },
      {
        identifier: 'agent-regular',
        shareVisitorUserId: 'visitor-1',
        throwIfExecutionAborted: async () => {},
      },
    );

    expect(getInfoForAIGeneration).toHaveBeenCalledWith(expect.anything(), 'visitor-1');
    expect(agentConfig.systemRole).toContain('Preferred reply language: ja-JP');
  });

  it('reads the reply language for the caller on an ordinary run', async () => {
    await resolveRunAgentConfig(
      {
        ...deps,
        resolveAgentConfigOrThrow: async () =>
          ({ ...(webOnboardingRow() as object), id: 'agent-regular', slug: null }) as never,
      },
      { identifier: 'agent-regular', throwIfExecutionAborted: async () => {} },
    );

    expect(getInfoForAIGeneration).toHaveBeenCalledWith(expect.anything(), 'member-1');
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

/** @example A Task model override must reach the Codex command, not only agentConfig.model. */
describe('Codex Task model overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPreference.mockResolvedValue({});
    isResourceAuthorOrAdmin.mockResolvedValue(false);
    getInfoForAIGeneration.mockResolvedValue({ responseLanguage: 'en-US' });
  });

  /** @example Task gpt-5.4 replaces the assignee's gpt-5.5 CLI argument. */
  it.each(['codex', undefined])(
    'applies a Task model with provider %s before snapshots are built',
    async (providerOverride) => {
      // ROOT CAUSE:
      //
      // TaskRunner passes model/provider overrides to execAgent, but the resolver
      // previously changed only the ordinary agent model fields. Codex dispatch
      // reads agencyConfig.heterogeneousProvider, so it still ran the Agent model.
      // Apply the same runtime-aware pin merger used by topic execution.
      const row: AgentConfigWithId = {
        ...(webOnboardingRow() as AgentConfigWithId),
        agencyConfig: {
          heterogeneousProvider: {
            args: ['--model', 'gpt-5.5'],
            effort: 'high',
            speed: 'fast',
            type: 'codex',
          },
        },
        id: 'agent-codex',
        slug: null,
      };
      const { agentConfig } = await resolveRunAgentConfig(
        { ...deps, resolveAgentConfigOrThrow: async () => row },
        {
          identifier: row.id,
          modelOverride: 'gpt-5.4',
          providerOverride,
          throwIfExecutionAborted: async () => {},
        },
      );

      /** @example The dispatched CLI receives the Task model and retains Agent effort/speed. */
      expect(buildHeteroExecArgs(agentConfig.agencyConfig!.heterogeneousProvider!)).toEqual([
        '--model',
        'gpt-5.4',
        '--effort',
        'high',
        '--speed',
        'fast',
      ]);
    },
  );
});
