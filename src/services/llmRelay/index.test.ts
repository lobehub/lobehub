import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLlmExecutorDeclaration } from './index';

const state = vi.hoisted(() => ({
  aiInfra: {} as Record<string, unknown>,
  featureFlags: {} as Record<string, unknown>,
}));

vi.mock('@/store/aiInfra', () => ({ getAiInfraStoreState: () => state.aiInfra }));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({ featureFlags: state.featureFlags }),
}));
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
