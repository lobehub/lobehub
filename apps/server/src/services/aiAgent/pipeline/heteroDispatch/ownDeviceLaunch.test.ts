import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveOwnDeviceLaunch } from './ownDeviceLaunch';

const { getAiProviderById } = vi.hoisted(() => ({ getAiProviderById: vi.fn() }));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(function () {
    return { getAiProviderById };
  }),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));

const deps = { db: {} as any, userId: 'user-1' };

const claudeCode = {
  command: '/opt/bin/claude',
  env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
  type: 'claude-code' as const,
};

describe('resolveOwnDeviceLaunch', () => {
  beforeEach(() => {
    getAiProviderById.mockReset();
  });

  it("forwards the agent's command and env to the requester's own personal device", async () => {
    await expect(
      resolveOwnDeviceLaunch(deps, {
        canManageAgent: true,
        heteroType: 'claude-code',
        heterogeneousProvider: claudeCode,
      }),
    ).resolves.toEqual({
      agentCommand: '/opt/bin/claude',
      agentEnv: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    });
  });

  it('forwards nothing to a workspace device', async () => {
    await expect(
      resolveOwnDeviceLaunch(deps, {
        canManageAgent: true,
        deviceWorkspaceId: 'ws-1',
        heteroType: 'claude-code',
        heterogeneousProvider: claudeCode,
      }),
    ).resolves.toEqual({});
  });

  it('forwards nothing from an agent the requester cannot manage', async () => {
    await expect(
      resolveOwnDeviceLaunch(deps, {
        canManageAgent: false,
        heteroType: 'claude-code',
        heterogeneousProvider: claudeCode,
      }),
    ).resolves.toEqual({});
  });

  it("adds the requester's DeepSeek key for DeepSeek Harness", async () => {
    getAiProviderById.mockResolvedValue({ keyVaults: { apiKey: 'sk-deepseek' } });

    await expect(
      resolveOwnDeviceLaunch(deps, {
        canManageAgent: false,
        heteroType: 'deepseek-harness',
        heterogeneousProvider: { type: 'deepseek-harness' },
      }),
    ).resolves.toEqual({ agentEnv: { DEEPSEEK_API_KEY: 'sk-deepseek' } });
  });

  it("keeps the agent's own DeepSeek key over the provider key", async () => {
    await expect(
      resolveOwnDeviceLaunch(deps, {
        canManageAgent: true,
        heteroType: 'deepseek-harness',
        heterogeneousProvider: { env: { DEEPSEEK_API_KEY: 'sk-agent' }, type: 'deepseek-harness' },
      }),
    ).resolves.toEqual({ agentEnv: { DEEPSEEK_API_KEY: 'sk-agent' } });
    expect(getAiProviderById).not.toHaveBeenCalled();
  });

  it('launches DeepSeek Harness without a key when the provider read fails', async () => {
    getAiProviderById.mockRejectedValue(new Error('db down'));

    await expect(
      resolveOwnDeviceLaunch(deps, {
        canManageAgent: false,
        heteroType: 'deepseek-harness',
        heterogeneousProvider: { type: 'deepseek-harness' },
      }),
    ).resolves.toEqual({});
  });
});
