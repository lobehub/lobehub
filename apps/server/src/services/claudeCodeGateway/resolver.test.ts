import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClaudeCodeGatewayProvider } from './resolver';

const mocks = vi.hoisted(() => ({
  getRuntimeState: vi.fn(),
  getServerGlobalConfig: vi.fn(),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: mocks.getServerGlobalConfig,
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn(() => ({ getAiProviderRuntimeState: mocks.getRuntimeState })),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));

describe('resolveClaudeCodeGatewayProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerGlobalConfig.mockResolvedValue({ aiProvider: {} });
    mocks.getRuntimeState.mockResolvedValue({
      enabledAiModels: [{ id: 'claude-sonnet', providerId: 'anthropic', type: 'chat' }],
      enabledAiProviders: [{ id: 'anthropic' }],
      runtimeConfig: {
        anthropic: {
          keyVaults: { apiKey: 'secret', baseURL: 'https://api.anthropic.com/v1' },
          settings: {
            claudeCode: { gateway: 'anthropic-messages' },
            sdkType: 'anthropic',
          },
        },
      },
    });
  });

  it('resolves an enabled BYOK provider to the Anthropic Messages endpoint', async () => {
    await expect(
      resolveClaudeCodeGatewayProvider({
        db: {} as never,
        model: 'claude-sonnet',
        providerId: 'anthropic',
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      apiKey: 'secret',
      baseURL: 'https://api.anthropic.com/v1/messages',
    });
  });

  it('rejects providers without an explicit gateway capability', async () => {
    const state = await mocks.getRuntimeState();
    state.runtimeConfig.anthropic.settings.claudeCode = undefined;
    mocks.getRuntimeState.mockResolvedValue(state);

    await expect(
      resolveClaudeCodeGatewayProvider({
        db: {} as never,
        model: 'claude-sonnet',
        providerId: 'anthropic',
        userId: 'user-1',
      }),
    ).rejects.toThrow('has not enabled the Claude Code Gateway');
  });

  it('rejects a private provider endpoint', async () => {
    const state = await mocks.getRuntimeState();
    state.runtimeConfig.anthropic.keyVaults.baseURL = 'https://127.0.0.1';
    mocks.getRuntimeState.mockResolvedValue(state);

    await expect(
      resolveClaudeCodeGatewayProvider({
        db: {} as never,
        model: 'claude-sonnet',
        providerId: 'anthropic',
        userId: 'user-1',
      }),
    ).rejects.toThrow('cannot reach private provider addresses');
  });
});
