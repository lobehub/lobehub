import { beforeEach, describe, expect, it, vi } from 'vitest';

import { genServerAiProvidersConfig } from './genServerAiProviderConfig';

// Mock dependencies using importOriginal to preserve real provider data
vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof import('model-bank')>();
  return {
    ...actual,
    // Keep the original exports but we can override specific ones if needed
  };
});

vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({
    ENABLED_OPENAI: true,
    ENABLED_ANTHROPIC: false,
    ENABLED_AI21: false,
  })),
}));

vi.mock('@/utils/server/parseModels', () => ({
  extractEnabledModels: vi.fn(async (providerId: string, modelString?: string) => {
    if (!modelString) return undefined;
    return [`${providerId}-model-1`, `${providerId}-model-2`];
  }),
  transformToAiModelList: vi.fn(async (params) => {
    return params.defaultModels;
  }),
}));

describe('genServerAiProvidersConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment variables
    Object.keys(process.env).forEach((key) => {
      if (key.includes('MODEL_LIST')) {
        delete process.env[key];
      }
    });
  });

  it('should generate basic provider config with default settings', async () => {
    const result = await genServerAiProvidersConfig({});

    expect(result).toHaveProperty('openai');
    expect(result).toHaveProperty('anthropic');

    expect(result.openai).toEqual({
      enabled: true,
      enabledModels: undefined,
      serverModelLists: expect.any(Array),
    });

    expect(result.anthropic).toEqual({
      enabled: false,
      enabledModels: undefined,
      serverModelLists: expect.any(Array),
    });
  });

  it('should use custom enabled settings from specificConfig', async () => {
    const specificConfig = {
      openai: {
        enabled: false,
      },
      anthropic: {
        enabled: true,
      },
    };

    const result = await genServerAiProvidersConfig(specificConfig);

    expect(result.openai.enabled).toBe(false);
    expect(result.anthropic.enabled).toBe(true);
  });

  it('should use custom enabledKey from specificConfig', async () => {
    const specificConfig = {
      openai: {
        enabledKey: 'CUSTOM_OPENAI_ENABLED',
      },
    };

    // Mock the LLM config to include our custom key
    const { getLLMConfig } = vi.mocked(await import('@/envs/llm'));
    getLLMConfig.mockReturnValue({
      ENABLED_OPENAI: true,
      ENABLED_ANTHROPIC: false,
      CUSTOM_OPENAI_ENABLED: true,
    } as any);

    const result = await genServerAiProvidersConfig(specificConfig);

    expect(result.openai.enabled).toBe(true);
  });

  it('should use environment variables for model lists', async () => {
    process.env.OPENAI_MODEL_LIST = '+gpt-4,+gpt-3.5-turbo';

    const { extractEnabledModels } = vi.mocked(await import('@/utils/server/parseModels'));
    extractEnabledModels.mockResolvedValue(['gpt-4', 'gpt-3.5-turbo']);

    const result = await genServerAiProvidersConfig({});

    expect(extractEnabledModels).toHaveBeenCalledWith('openai', '+gpt-4,+gpt-3.5-turbo', false);
    expect(result.openai.enabledModels).toEqual(['gpt-4', 'gpt-3.5-turbo']);
  });

  it('should use custom modelListKey from specificConfig', async () => {
    const specificConfig = {
      openai: {
        modelListKey: 'CUSTOM_OPENAI_MODELS',
      },
    };

    process.env.CUSTOM_OPENAI_MODELS = '+custom-model';

    const { extractEnabledModels } = vi.mocked(await import('@/utils/server/parseModels'));

    await genServerAiProvidersConfig(specificConfig);

    expect(extractEnabledModels).toHaveBeenCalledWith('openai', '+custom-model', false);
  });

  it('should handle withDeploymentName option', async () => {
    const specificConfig = {
      openai: {
        withDeploymentName: true,
      },
    };

    process.env.OPENAI_MODEL_LIST = '+gpt-4->deployment1';

    const { extractEnabledModels, transformToAiModelList } = vi.mocked(
      await import('@/utils/server/parseModels'),
    );

    await genServerAiProvidersConfig(specificConfig);

    expect(extractEnabledModels).toHaveBeenCalledWith('openai', '+gpt-4->deployment1', true);
    expect(transformToAiModelList).toHaveBeenCalledWith({
      defaultModels: expect.any(Array),
      modelString: '+gpt-4->deployment1',
      providerId: 'openai',
      withDeploymentName: true,
    });
  });

  it('should include fetchOnClient when specified in config', async () => {
    const specificConfig = {
      openai: {
        fetchOnClient: true,
      },
    };

    const result = await genServerAiProvidersConfig(specificConfig);

    expect(result.openai).toHaveProperty('fetchOnClient', true);
  });

  it('should not include fetchOnClient when not specified in config', async () => {
    const result = await genServerAiProvidersConfig({});

    expect(result.openai).not.toHaveProperty('fetchOnClient');
  });

  it('should handle all available providers', async () => {
    const result = await genServerAiProvidersConfig({});

    // Check that result includes some key providers
    expect(result).toHaveProperty('openai');
    expect(result).toHaveProperty('anthropic');

    // Check structure for each provider
    Object.keys(result).forEach((provider) => {
      expect(result[provider]).toHaveProperty('enabled');
      expect(result[provider]).toHaveProperty('serverModelLists');
      // enabled can be boolean or undefined (when no config is provided)
      expect(['boolean', 'undefined']).toContain(typeof result[provider].enabled);
      expect(Array.isArray(result[provider].serverModelLists)).toBe(true);
    });
  });
});

describe('genServerAiProvidersConfig Error Handling', () => {
  it('should throw error when a provider is not found in aiModels', async () => {
    // Reset all mocks to create a clean test environment
    vi.resetModules();

    // Mock dependencies with a missing provider scenario
    vi.doMock('model-bank', () => ({
      // Explicitly set openai to undefined to simulate missing provider
      openai: undefined,
      anthropic: [
        {
          id: 'claude-3',
          displayName: 'Claude 3',
          type: 'chat',
          enabled: true,
        },
      ],
    }));

    vi.doMock('@/config/llm', () => ({
      getLLMConfig: vi.fn(() => ({})),
    }));

    vi.doMock('@/utils/server/parseModels', () => ({
      extractEnabledModels: vi.fn(async () => undefined),
      transformToAiModelList: vi.fn(async () => []),
    }));

    // Mock ModelProvider to include the missing provider
    vi.doMock('model-bank', () => ({
      ModelProvider: {
        openai: 'openai', // This exists in enum
        anthropic: 'anthropic', // This exists in both enum and aiModels
      },
    }));

    // Import the function with the new mocks
    const { genServerAiProvidersConfig } = await import(
      './genServerAiProviderConfig?v=' + Date.now()
    );

    // This should throw because 'openai' is in ModelProvider but not in aiModels
    await expect(async () => {
      await genServerAiProvidersConfig({});
    }).rejects.toThrow();
  });
});
