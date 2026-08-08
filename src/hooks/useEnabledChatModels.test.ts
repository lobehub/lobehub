import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAiInfraStore = vi.fn();
const useAicoBillingStore = vi.fn();
const useClientDataSWR = vi.fn();

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
          { children: [{ id: 'openrouter/auto' }], id: 'openrouter' },
          { children: [{ id: 'gemini-flash' }], id: 'google' },
          { children: [{ id: 'gpt-4o' }], id: 'openai' },
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
});
