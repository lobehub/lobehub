import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModelSelect from './index';

const { guardState, selectState, storeState } = vi.hoisted(() => ({
  guardState: {} as { isModelHidden?: (modelId: string, providerId: string) => boolean },
  selectState: { options: undefined as unknown },
  storeState: {
    builtinAiModelList: [],
    enabledAiProviders: [],
    enabledChatModelList: [
      {
        children: [
          { abilities: {}, displayName: 'Mini', id: 'mini' },
          { abilities: {}, displayName: 'Opus', id: 'opus' },
        ],
        id: 'lobehub',
        name: 'LobeHub',
      },
      {
        children: [{ abilities: {}, displayName: 'Opus', id: 'opus' }],
        id: 'openai',
        name: 'OpenAI',
      },
    ],
    isInitAiProviderRuntimeState: true,
    modelRedirects: {},
    toggleProviderEnabled: vi.fn(),
    toggleProviderModelEnabled: vi.fn(),
  },
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Select: ({ options }: { options?: unknown }) => {
    selectState.options = options;
    return null;
  },
}));

vi.mock('@/business/client/hooks/useBusinessModelListGuard', () => ({
  useBusinessModelListGuard: () => guardState,
}));

vi.mock('@/components/ModelSelect', () => ({
  ModelItemRender: () => null,
  ProviderItemRender: () => null,
  TAG_CLASSNAME: 'tag',
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {},
  useAiInfraStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

type Group = { options: { value: string }[] };

const optionValues = () =>
  (selectState.options as Group[]).flatMap((group) => group.options.map((option) => option.value));

describe('ModelSelect business-hidden models', () => {
  beforeEach(() => {
    guardState.isModelHidden = undefined;
    selectState.options = undefined;
  });

  it('offers every enabled chat model without a hidden predicate', () => {
    renderToStaticMarkup(<ModelSelect />);

    expect(optionValues()).toEqual(['lobehub/mini', 'lobehub/opus', 'openai/opus']);
  });

  it('leaves out the models the business guard hides', () => {
    guardState.isModelHidden = (modelId, providerId) =>
      providerId === 'lobehub' && modelId === 'opus';

    renderToStaticMarkup(<ModelSelect />);

    expect(optionValues()).toEqual(['lobehub/mini', 'openai/opus']);
  });
});
