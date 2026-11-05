import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLlmExecutorDeclaration, oneShotRelay } from './index';

const state = vi.hoisted(() => ({
  aiInfra: {} as Record<string, unknown>,
  featureFlags: {} as Record<string, unknown>,
  serverConfig: {} as Record<string, unknown>,
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    isProviderFetchOnClient: (provider: string) => () => provider === 'ollama',
  },
  getAiInfraStoreState: () => state.aiInfra,
}));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({
    featureFlags: state.featureFlags,
    serverConfig: state.serverConfig,
  }),
}));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { userId: () => 'user-1' } }));
vi.mock('./clientId', () => ({ getLlmRelayClientId: () => 'tab-1' }));

describe('buildLlmExecutorDeclaration', () => {
  beforeEach(() => {
    state.featureFlags = { enableLlmRelay: true };
    // A chat page loads the runtime state only; the settings-page provider
    // list stays empty there.
    state.aiInfra = {
      aiProviderList: [],
      enabledAiProviders: [{ id: 'lmstudio' }, { id: 'ollama' }],
    };
  });

  it('declares the providers of the runtime state a chat page has loaded', () => {
    expect(buildLlmExecutorDeclaration()).toEqual({
      capabilities: ['llm_relay@1', 'llm_client_wait@1'],
      clientId: 'tab-1',
      providers: ['lmstudio', 'ollama'],
    });
  });

  it('declares nothing outside the agent_llm_relay rollout', () => {
    state.featureFlags = { enableLlmRelay: false };
    expect(buildLlmExecutorDeclaration()).toBeUndefined();
  });
});

describe('oneShotRelay availability', () => {
  beforeEach(() => {
    state.featureFlags = { enableLlmRelay: true };
    state.serverConfig = { agentGatewayUrl: 'https://gw', llmRelayAvailable: true };
  });

  it('relays a device-only provider where the deployment can relay', () => {
    expect(oneShotRelay.needsRelay('ollama')).toBe(true);
    expect(oneShotRelay.needsRelay('openai')).toBe(false);
  });

  // A gateway URL without Redis: the server cannot relay and would call the
  // device-only provider itself, so the browser keeps its own fallback.
  it('keeps the browser fallback where the server cannot relay', () => {
    state.serverConfig = { agentGatewayUrl: 'https://gw', llmRelayAvailable: false };
    expect(oneShotRelay.needsRelay('ollama')).toBe(false);
  });
});
