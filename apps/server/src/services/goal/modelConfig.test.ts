// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertGoalModelRunnable, resolveGoalModelConfig } from './modelConfig';

const getUserSettings = vi.hoisted(() => vi.fn());
const assertWorkspaceByokAllowed = vi.hoisted(() => vi.fn(async () => {}));
const resolveProviderRelay = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/business/server/workspaceByok', () => ({ assertWorkspaceByokAllowed }));
vi.mock('@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite', () => ({
  resolveProviderRelay,
}));
vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: async () => ({ aiProvider: {} }),
}));
vi.mock('@/database/repositories/aiInfra', () => ({ AiInfraRepos: class {} }));
vi.mock('@/server/services/aiProviderAccess', () => ({
  getUserScopedAiProviderRuntimeState: async () => ({
    enabledAiModels: [{ id: 'gpt-5', providerId: 'openai' }],
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = getUserSettings;
  },
}));

describe('resolveGoalModelConfig', () => {
  it("uses the goal's planning model without reading the system setting", async () => {
    await expect(
      resolveGoalModelConfig({} as never, 'user-1', {
        model: 'gemini-3.8-flash',
        provider: 'google',
      }),
    ).resolves.toEqual({ model: 'gemini-3.8-flash', provider: 'google' });
    expect(getUserSettings).not.toHaveBeenCalled();
  });

  it('falls back to the system goal model without a complete goal pick', async () => {
    getUserSettings.mockResolvedValue({
      systemAgent: { goal: { model: 'system-goal', provider: 'system-provider' } },
    });

    const resolved = await resolveGoalModelConfig({} as never, 'user-1', { model: 'gemini-only' });

    expect(getUserSettings).toHaveBeenCalled();
    expect(resolved).toMatchObject({ model: 'system-goal', provider: 'system-provider' });
  });
});

describe('assertGoalModelRunnable', () => {
  const pick = { model: 'gpt-5', provider: 'openai' };
  const owner = { userId: 'user-1', workspaceId: 'ws-1' };

  beforeEach(() => {
    assertWorkspaceByokAllowed.mockClear();
    resolveProviderRelay.mockClear();
  });

  it('refuses a provider the workspace may not use as a request error', async () => {
    assertWorkspaceByokAllowed.mockRejectedValueOnce({
      errorType: 'WorkspaceByokNotEnabled',
      message: 'This workspace can only use LobeHub models.',
    });

    await expect(
      assertGoalModelRunnable({} as never, owner, 'planning', pick),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'This workspace can only use LobeHub models.',
    });
    expect(resolveProviderRelay).not.toHaveBeenCalled();
  });

  it('skips the workspace key gate for a personal goal', async () => {
    await expect(
      assertGoalModelRunnable({} as never, { userId: 'user-1' }, 'planning', pick),
    ).resolves.toBeUndefined();
    expect(assertWorkspaceByokAllowed).not.toHaveBeenCalled();
  });
});
