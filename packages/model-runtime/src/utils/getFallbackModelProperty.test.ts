import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPropertyWithFallback } from './getFallbackModelProperty';

const { loadModelsMock, mockModelList } = vi.hoisted(() => ({
  loadModelsMock: vi.fn(),
  mockModelList: [
    {
      abilities: {
        functionCall: true,
        vision: true,
      },
      contextWindowTokens: 8192,
      displayName: 'GPT-4',
      enabled: true,
      id: 'gpt-4',
      parameters: {
        maxTokens: 4096,
        temperature: 0.7,
      },
      providerId: 'openai',
      type: 'chat',
    },
    {
      abilities: {
        functionCall: true,
      },
      contextWindowTokens: 8192,
      displayName: 'GPT-4 Azure',
      enabled: true,
      id: 'gpt-4',
      providerId: 'azure',
      type: 'chat',
    },
    {
      contextWindowTokens: 200000,
      displayName: 'Claude 3',
      enabled: false,
      id: 'claude-3',
      providerId: 'anthropic',
      type: 'chat',
    },
    {
      displayName: 'DALL-E 3',
      enabled: true,
      id: 'dall-e-3',
      parameters: {
        quality: 'standard',
        size: '1024x1024',
      },
      providerId: 'openai',
      type: 'image',
    },
  ],
}));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

describe('getModelPropertyWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadModelsMock.mockResolvedValue([...mockModelList]);
  });

  describe('when providerId is specified', () => {
    it('should use injected LobeHub model config before static fallback', async () => {
      loadModelsMock.mockResolvedValue([
        ...mockModelList,
        {
          providerId: 'lobehub',
          source: 'builtin',
          enabled: true,
          id: 'injected-model',
          type: 'chat',
          displayName: 'Injected LobeHub Model',
        },
      ]);

      const result = await getModelPropertyWithFallback('injected-model', 'displayName', 'lobehub');

      expect(loadModelsMock).toHaveBeenCalledTimes(1);
      expect(result).toBe('Injected LobeHub Model');
    });

    it('should propagate loadModels errors instead of falling back to static defaults', async () => {
      loadModelsMock.mockRejectedValue(new Error('model config missing'));

      await expect(
        getModelPropertyWithFallback('injected-model', 'displayName', 'lobehub'),
      ).rejects.toThrow('model config missing');
    });

    it('should prefer the injected LobeHub model over another provider with the same id', async () => {
      loadModelsMock.mockResolvedValue([
        {
          displayName: 'Static Same ID',
          id: 'same-model',
          providerId: 'openai',
          type: 'chat',
        },
        {
          displayName: 'Injected LobeHub Model',
          id: 'same-model',
          providerId: 'lobehub',
          type: 'chat',
        },
      ]);

      const result = await getModelPropertyWithFallback('same-model', 'displayName', 'lobehub');
      expect(result).toBe('Injected LobeHub Model');
    });

    it('should return exact match value when model exists with specified provider', async () => {
      const result = await getModelPropertyWithFallback('gpt-4', 'displayName', 'openai');
      expect(result).toBe('GPT-4');
    });

    it('should return exact match type when model exists with specified provider', async () => {
      const result = await getModelPropertyWithFallback('gpt-4', 'type', 'openai');
      expect(result).toBe('chat');
    });

    it('should return exact match contextWindowTokens when model exists with specified provider', async () => {
      const result = await getModelPropertyWithFallback('gpt-4', 'contextWindowTokens', 'azure');
      expect(result).toBe(8192);
    });

    it('should fall back to other provider when exact provider match not found', async () => {
      const result = await getModelPropertyWithFallback('gpt-4', 'displayName', 'fake-provider');
      expect(result).toBe('GPT-4'); // Falls back to openai provider
    });

    it('should return nested property like abilities', async () => {
      const result = await getModelPropertyWithFallback('gpt-4', 'abilities', 'openai');
      expect(result).toEqual({
        functionCall: true,
        vision: true,
      });
    });

    it('should return parameters property correctly', async () => {
      const result = await getModelPropertyWithFallback('dall-e-3', 'parameters', 'openai');
      expect(result).toEqual({
        size: '1024x1024',
        quality: 'standard',
      });
    });
  });

  describe('when providerId is not specified', () => {
    it('should return fallback match value when model exists', async () => {
      const result = await getModelPropertyWithFallback('claude-3', 'displayName');
      expect(result).toBe('Claude 3');
    });

    it('should return fallback match type when model exists', async () => {
      const result = await getModelPropertyWithFallback('claude-3', 'type');
      expect(result).toBe('chat');
    });

    it('should return fallback match enabled property', async () => {
      const result = await getModelPropertyWithFallback('claude-3', 'enabled');
      expect(result).toBe(false);
    });
  });

  describe('when model is not found', () => {
    it('should return default value "chat" for type property', async () => {
      const result = await getModelPropertyWithFallback('non-existent-model', 'type');
      expect(result).toBe('chat');
    });

    it('should return default value "chat" for type property even with providerId', async () => {
      const result = await getModelPropertyWithFallback(
        'non-existent-model',
        'type',
        'fake-provider',
      );
      expect(result).toBe('chat');
    });

    it('should return undefined for non-type properties when model not found', async () => {
      const result = await getModelPropertyWithFallback('non-existent-model', 'displayName');
      expect(result).toBeUndefined();
    });

    it('should return undefined for contextWindowTokens when model not found', async () => {
      const result = await getModelPropertyWithFallback(
        'non-existent-model',
        'contextWindowTokens',
      );
      expect(result).toBeUndefined();
    });

    it('should return undefined for enabled property when model not found', async () => {
      const result = await getModelPropertyWithFallback('non-existent-model', 'enabled');
      expect(result).toBeUndefined();
    });
  });

  describe('provider precedence logic', () => {
    it('should prioritize exact provider match over general match', async () => {
      // gpt-4 exists in both openai and azure providers with different displayNames
      const openaiResult = await getModelPropertyWithFallback('gpt-4', 'displayName', 'openai');
      const azureResult = await getModelPropertyWithFallback('gpt-4', 'displayName', 'azure');

      expect(openaiResult).toBe('GPT-4');
      expect(azureResult).toBe('GPT-4 Azure');
    });

    it('should fall back to first match when specified provider not found', async () => {
      // When asking for 'fake-provider', should fall back to first match (openai)
      const result = await getModelPropertyWithFallback('gpt-4', 'displayName', 'fake-provider');
      expect(result).toBe('GPT-4');
    });
  });

  describe('property existence handling', () => {
    it('should handle undefined properties gracefully', async () => {
      // claude-3 doesn't have abilities property defined
      const result = await getModelPropertyWithFallback('claude-3', 'abilities');
      expect(result).toBeUndefined();
    });

    it('should handle properties that exist but have falsy values', async () => {
      // claude-3 has enabled: false
      const result = await getModelPropertyWithFallback('claude-3', 'enabled');
      expect(result).toBe(false);
    });

    it('should distinguish between undefined and null values', async () => {
      // Testing that we check for undefined specifically, not just falsy values
      const result = await getModelPropertyWithFallback('claude-3', 'contextWindowTokens');
      expect(result).toBe(200000); // Should find the defined value
    });
  });

  describe('edge cases', () => {
    it('should handle empty string modelId', async () => {
      const result = await getModelPropertyWithFallback('', 'type');
      expect(result).toBe('chat'); // Should fall back to default
    });

    it('should handle empty string providerId', async () => {
      const result = await getModelPropertyWithFallback('gpt-4', 'type', '');
      expect(result).toBe('chat'); // Should still find the model via fallback
    });

    it('should handle case-sensitive modelId correctly', async () => {
      const result = await getModelPropertyWithFallback('GPT-4', 'type'); // Wrong case
      expect(result).toBe('chat'); // Should fall back to default since no match
    });
  });
});
