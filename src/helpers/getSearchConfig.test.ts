import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import * as aiInfraSelectors from '@/store/aiInfra/selectors';

import { getSearchConfig } from './getSearchConfig';

// Mock the store dependencies
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  chatConfigByIdSelectors: {
    getChatConfigById: vi.fn(),
  },
}));

vi.mock('@/store/aiInfra', () => ({
  getAiInfraStoreState: () => ({}),
}));

vi.mock('@/store/aiInfra/selectors', () => ({
  aiProviderSelectors: {
    isProviderHasBuiltinSearch: vi.fn(),
  },
  aiModelSelectors: {
    isModelHasBuiltinSearch: vi.fn(),
    isModelBuiltinSearchInternal: vi.fn(),
  },
}));

describe('getSearchConfig', () => {
  const model = 'gpt-4';
  const provider = 'openai';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return correct config when search is enabled and no builtin search', () => {
    vi.mocked(chatConfigByIdSelectors.getChatConfigById).mockReturnValue(
      () =>
        ({
          searchMode: 'on',
          useModelBuiltinSearch: false,
        }) as any,
    );

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: false,
      useModelSearch: false,
      useApplicationBuiltinSearchTool: true,
    });
  });

  it('should return correct config when search is disabled', () => {
    vi.mocked(chatConfigByIdSelectors.getChatConfigById).mockReturnValue(
      () =>
        ({
          searchMode: 'off',
          useModelBuiltinSearch: false,
        }) as any,
    );

    const result = getSearchConfig(model, provider);

    expect(result.enabledSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
    expect(result.useModelSearch).toBe(false);
  });

  it('should prefer model search when available and enabled', () => {
    vi.mocked(chatConfigByIdSelectors.getChatConfigById).mockReturnValue(
      () =>
        ({
          searchMode: 'on',
          useModelBuiltinSearch: true,
        }) as any,
    );

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: true,
      isModelHasBuiltinSearch: false,
      useModelSearch: true,
      useApplicationBuiltinSearchTool: false,
    });
  });

  it('should use model search when model has builtin search and it is enabled', () => {
    vi.mocked(chatConfigByIdSelectors.getChatConfigById).mockReturnValue(
      () =>
        ({
          searchMode: 'on',
          useModelBuiltinSearch: true,
        }) as any,
    );

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: true,
      useModelSearch: true,
      useApplicationBuiltinSearchTool: false,
    });
  });

  it('should not use model search when model has builtin search but preference is disabled', () => {
    vi.mocked(chatConfigByIdSelectors.getChatConfigById).mockReturnValue(
      () =>
        ({
          searchMode: 'on',
          useModelBuiltinSearch: false,
        }) as any,
    );

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: true,
      useModelSearch: false,
      useApplicationBuiltinSearchTool: true,
    });
  });

  it('should force use model search when searchImpl is internal', () => {
    vi.mocked(chatConfigByIdSelectors.getChatConfigById).mockReturnValue(
      () =>
        ({
          searchMode: 'on',
          useModelBuiltinSearch: false,
        }) as any,
    );

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => true,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: true,
      useModelSearch: true,
      useApplicationBuiltinSearchTool: false,
    });
  });
});
