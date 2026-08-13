import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentProjectionById } from '@/projection';
import * as aiInfraSelectors from '@/store/aiInfra/selectors';

import { getSearchConfig } from './getSearchConfig';

// Mock the store dependencies
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({}),
}));

vi.mock('@/projection', () => ({ getAgentProjectionById: vi.fn() }));

vi.mock('@/store/aiInfra', () => ({
  getAiInfraStoreState: () => ({}),
}));

vi.mock('@/store/aiInfra/selectors', () => ({
  aiProviderSelectors: {
    providerConfigById: vi.fn(),
  },
  aiModelSelectors: {
    modelBuiltinSearchImpl: vi.fn(),
  },
}));

describe('getSearchConfig', () => {
  const model = 'gpt-4';
  const provider = 'openai';
  const mockChatConfig = (chatConfig: Record<string, unknown>) =>
    vi.mocked(getAgentProjectionById).mockReturnValue({ chatConfig } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiInfraSelectors.aiProviderSelectors.providerConfigById).mockReturnValue(
      () => undefined,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => undefined,
    );
  });

  it('should return correct config when search is enabled and no builtin search', () => {
    mockChatConfig({ searchMode: 'on', useModelBuiltinSearch: false });

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
    mockChatConfig({ searchMode: 'off', useModelBuiltinSearch: false });

    const result = getSearchConfig(model, provider);

    expect(result.enabledSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
    expect(result.useModelSearch).toBe(false);
  });

  it('should prefer model search when available and enabled', () => {
    mockChatConfig({ searchMode: 'on', useModelBuiltinSearch: true });

    vi.mocked(aiInfraSelectors.aiProviderSelectors.providerConfigById).mockReturnValue(
      () => ({ settings: { searchMode: 'params' } }) as any,
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
    mockChatConfig({ searchMode: 'on', useModelBuiltinSearch: true });

    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => 'params',
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
    mockChatConfig({ searchMode: 'on', useModelBuiltinSearch: false });

    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => 'params',
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
    mockChatConfig({ searchMode: 'on', useModelBuiltinSearch: false });

    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => 'internal',
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
