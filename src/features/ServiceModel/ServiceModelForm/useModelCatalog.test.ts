import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelOptions } from './useModelCatalog';

const { guard, state } = vi.hoisted(() => ({
  guard: { current: {} as { isModelHidden?: (model: string, provider: string) => boolean } },
  state: {
    aiProviderRuntimeConfig: {},
    enabledAiModels: [],
    enabledAiProviders: [],
    enabledChatModelList: [
      {
        children: [
          { abilities: { vision: true }, displayName: 'Mini', id: 'mini' },
          { abilities: { vision: true }, displayName: 'Opus', id: 'opus' },
        ],
        id: 'lobehub',
        name: 'LobeHub',
      },
      { children: [{ abilities: {}, id: 'gpt' }], id: 'openai', name: 'OpenAI' },
    ],
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: { enabledAsrModelList: () => [], enabledEmbeddingModelList: () => [] },
  useAiInfraStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('@/business/client/hooks/useBusinessModelListGuard', () => ({
  useBusinessModelListGuard: () => guard.current,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ModelLabel', () => ({ default: () => null }));

const values = (kind: 'chat' | 'vision') => {
  const { result } = renderHook(() => useModelOptions(kind));
  return (result.current.groups as { options: { value: string }[] }[]).flatMap((group) =>
    group.options.map((option) => option.value),
  );
};

describe('useModelOptions', () => {
  beforeEach(() => {
    guard.current = {};
  });

  it('offers every enabled chat model without a hiding policy', () => {
    expect(values('chat')).toEqual(['lobehub/mini', 'lobehub/opus', 'openai/gpt']);
  });

  it('leaves out chat and vision models the business policy hides', () => {
    guard.current = {
      isModelHidden: (model, provider) => provider === 'lobehub' && model === 'opus',
    };

    expect(values('chat')).toEqual(['lobehub/mini', 'openai/gpt']);
    expect(values('vision')).toEqual(['lobehub/mini']);
  });
});
