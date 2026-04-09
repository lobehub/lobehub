import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';

import { resolveRuntimeProvider } from './helper';

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    providerConfigById: vi.fn(),
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));

describe('resolveRuntimeProvider', () => {
  beforeEach(() => {
    vi.mocked(getAiInfraStoreState).mockReturnValue({} as any);
    vi.mocked(aiProviderSelectors.providerConfigById).mockReset();
  });

  it('returns builtin providers as-is', () => {
    expect(resolveRuntimeProvider(ModelProvider.EUrouter)).toBe(ModelProvider.EUrouter);
  });

  it('falls back to sdkType for custom providers', () => {
    vi.mocked(aiProviderSelectors.providerConfigById).mockReturnValue(
      () =>
        ({
          settings: {
            sdkType: ModelProvider.OpenAI,
          },
        }) as any,
    );

    expect(resolveRuntimeProvider('custom-provider')).toBe(ModelProvider.OpenAI);
  });
});
