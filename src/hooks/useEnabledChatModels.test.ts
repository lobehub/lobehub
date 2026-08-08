import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAiInfraStore = vi.fn();
const useAicoBillingStore = vi.fn();
const useClientDataSWR = vi.fn();
const getAiProviderModelList = vi.fn();

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: any) => useAiInfraStore(selector),
}));

vi.mock('@/features/AicoBilling/store', () => ({
  useAicoBillingStore: (selector: any) => useAicoBillingStore(selector),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (...args: any[]) => useClientDataSWR(...args),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aicoBilling: { getManagedProviderStatus: { query: vi.fn() } },
    organization: { getMyAllowedModels: { query: vi.fn() } },
  },
}));

vi.mock('@/services/aiModel', () => ({
  aiModelService: {
    getAiProviderModelList: (...args: unknown[]) => getAiProviderModelList(...args),
  },
}));

describe('useEnabledChatModels', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    useAicoBillingStore.mockImplementation((selector: any) =>
      selector({ context: { source: 'personal' } }),
    );
    useAiInfraStore.mockImplementation((selector: any) =>
      selector({
        enabledChatModelList: [
          {
            children: [{ id: 'openrouter/auto', displayName: 'Auto' }],
            id: 'openrouter',
            name: 'OpenRouter',
            source: 'builtin',
          },
          { children: [{ id: 'gemini-flash' }], id: 'google', name: 'Google', source: 'builtin' },
          { children: [{ id: 'gpt-4o' }], id: 'openai', name: 'OpenAI', source: 'builtin' },
        ],
      }),
    );
  });

  it('keeps only aico/openrouter providers when managed mode is on', async () => {
    useClientDataSWR.mockImplementation((key: unknown) => {
      if (key === 'aico-provider-status') return { data: { managed: true } };
      return { data: undefined };
    });

    const { useEnabledChatModels } = await import('./useEnabledChatModels');
    const { result } = renderHook(() => useEnabledChatModels());

    expect(result.current.map((p) => p.id)).toEqual(['openrouter']);
  });

  it('keeps BYOK providers when managed mode is off', async () => {
    useClientDataSWR.mockImplementation((key: unknown) => {
      if (key === 'aico-provider-status') return { data: { managed: false } };
      return { data: undefined };
    });

    const { useEnabledChatModels } = await import('./useEnabledChatModels');
    const { result } = renderHook(() => useEnabledChatModels());

    expect(result.current.map((p) => p.id)).toEqual(['openrouter', 'google', 'openai']);
  });

  it('on org wallet shows team allow-list models without personal enable', async () => {
    useAicoBillingStore.mockImplementation((selector: any) =>
      selector({ context: { organizationId: 'org-1', source: 'organization' } }),
    );
    // Personal enabled list does NOT include the team-granted model.
    useAiInfraStore.mockImplementation((selector: any) =>
      selector({
        enabledChatModelList: [
          {
            children: [{ id: 'openrouter/auto', displayName: 'Auto' }],
            id: 'openrouter',
            name: 'OpenRouter',
            source: 'builtin',
          },
        ],
      }),
    );

    useClientDataSWR.mockImplementation((key: unknown) => {
      if (key === 'aico-provider-status') return { data: { managed: true } };
      if (Array.isArray(key) && key[0] === 'aico-my-allowed-models') {
        return { data: { modelIds: ['openai/gpt-4o-mini'] } };
      }
      if (Array.isArray(key) && key[0] === 'aico-managed-model-catalog') {
        return {
          data: [
            {
              abilities: { functionCall: true },
              displayName: 'GPT-4o mini',
              enabled: false,
              id: 'openai/gpt-4o-mini',
              type: 'chat',
            },
            {
              abilities: {},
              displayName: 'Other',
              enabled: true,
              id: 'openai/gpt-4o',
              type: 'chat',
            },
          ],
        };
      }
      return { data: undefined };
    });

    const { useEnabledChatModels } = await import('./useEnabledChatModels');
    const { result } = renderHook(() => useEnabledChatModels());

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('openrouter');
    expect(result.current[0].children.map((m) => m.id)).toEqual(['openai/gpt-4o-mini']);
  });
});
