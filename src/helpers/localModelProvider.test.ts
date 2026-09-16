import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isLocalOnlyModelProvider, isLocalOnlyModelProviderForAgent } from './localModelProvider';

const aiInfraState = {
  aiProviderRuntimeConfig: {} as Record<string, { fetchOnClient?: boolean; keyVaults: any }>,
} as any;
const agentState = { activeAgentId: undefined, agentMap: {} } as any;

vi.mock('@/store/aiInfra', () => ({ getAiInfraStoreState: () => aiInfraState }));
vi.mock('@/store/agent', () => ({ getAgentStoreState: () => agentState }));
vi.mock('@/store/aiInfra/selectors', () => ({
  aiProviderSelectors: {
    isProviderFetchOnClient: (provider: string) => (s: typeof aiInfraState) =>
      !!s.aiProviderRuntimeConfig[provider]?.fetchOnClient,
    providerKeyVaults: (provider: string) => (s: typeof aiInfraState) =>
      s.aiProviderRuntimeConfig[provider]?.keyVaults,
  },
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentConfigById: (agentId: string) => (s: typeof agentState) => s.agentMap[agentId],
  },
}));

const setProvider = (id: string, config: { fetchOnClient?: boolean; keyVaults?: any }) => {
  aiInfraState.aiProviderRuntimeConfig[id] = { keyVaults: {}, ...config };
};

beforeEach(() => {
  aiInfraState.aiProviderRuntimeConfig = {};
  agentState.agentMap = {};
  agentState.activeAgentId = undefined;
});

describe('isLocalOnlyModelProvider', () => {
  it('flags a client-fetched provider on a loopback baseURL (LM Studio default)', () => {
    setProvider('lmstudio', {
      fetchOnClient: true,
      keyVaults: { baseURL: 'http://127.0.0.1:1234/v1' },
    });

    expect(isLocalOnlyModelProvider('lmstudio')).toBe(true);
  });

  it('flags localhost and private-network endpoints too', () => {
    setProvider('ollama', {
      fetchOnClient: true,
      keyVaults: { baseURL: 'http://localhost:11434' },
    });
    setProvider('vllm', {
      fetchOnClient: true,
      keyVaults: { baseURL: 'http://192.168.1.50:8000/v1' },
    });

    expect(isLocalOnlyModelProvider('ollama')).toBe(true);
    expect(isLocalOnlyModelProvider('vllm')).toBe(true);
  });

  it('reads the `endpoint` key vault when `baseURL` is absent', () => {
    setProvider('azure', { fetchOnClient: true, keyVaults: { endpoint: 'http://127.0.0.1:9000' } });

    expect(isLocalOnlyModelProvider('azure')).toBe(true);
  });

  it('does not flag a provider the deployment server is meant to call', () => {
    setProvider('lmstudio', {
      fetchOnClient: false,
      keyVaults: { baseURL: 'http://127.0.0.1:1234/v1' },
    });

    expect(isLocalOnlyModelProvider('lmstudio')).toBe(false);
  });

  it('does not flag a reachable endpoint, an unset endpoint, or a missing provider', () => {
    setProvider('openai', {
      fetchOnClient: true,
      keyVaults: { baseURL: 'https://api.openai.com/v1' },
    });
    setProvider('anthropic', { fetchOnClient: true, keyVaults: {} });

    expect(isLocalOnlyModelProvider('openai')).toBe(false);
    expect(isLocalOnlyModelProvider('anthropic')).toBe(false);
    expect(isLocalOnlyModelProvider('unknown')).toBe(false);
    expect(isLocalOnlyModelProvider(undefined)).toBe(false);
  });
});

describe('isLocalOnlyModelProviderForAgent', () => {
  beforeEach(() => {
    setProvider('lmstudio', {
      fetchOnClient: true,
      keyVaults: { baseURL: 'http://127.0.0.1:1234/v1' },
    });
    agentState.agentMap = {
      cloud: { model: 'gpt-5', provider: 'openai' },
      local: { model: 'qwen3-4b', provider: 'lmstudio' },
    };
  });

  it('resolves the provider from the agent config', () => {
    expect(isLocalOnlyModelProviderForAgent('local')).toBe(true);
    expect(isLocalOnlyModelProviderForAgent('cloud')).toBe(false);
  });

  it('falls back to the active agent, and is false with no agent at all', () => {
    agentState.activeAgentId = 'local';
    expect(isLocalOnlyModelProviderForAgent()).toBe(true);

    agentState.activeAgentId = undefined;
    expect(isLocalOnlyModelProviderForAgent()).toBe(false);
    expect(isLocalOnlyModelProviderForAgent('missing')).toBe(false);
  });
});
