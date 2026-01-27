import type { AgentItem } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';
import { describe, expect, it } from 'vitest';

// Import the private function by accessing it through module internals
// Since normalizeMarketAgentModel is not exported, we need to test it through the service methods
// However, for unit testing, we'll re-implement the logic to test it directly

/**
 * Market agent model can be either a string or an object with model details
 */
type MarketAgentModel =
  | string
  | {
      model: string;
      parameters?: Record<string, any>;
      provider?: string;
    };

/**
 * Normalize market agent config to standard agent config.
 * Handles the case where market returns model as an object instead of string.
 */
const normalizeMarketAgentModel = (config?: PartialDeep<AgentItem>): PartialDeep<AgentItem> => {
  if (!config) return {};

  const model = config.model as MarketAgentModel | undefined;

  // If model is not an object, return config as-is
  if (typeof model !== 'object' || model === null) {
    return config;
  }

  // Extract model info and merge parameters
  const { model: modelName, provider: modelProvider, parameters } = model;
  const existingParams = (config.params ?? {}) as Record<string, any>;
  const mergedParams = { ...parameters, ...existingParams };

  return {
    ...config,
    model: modelName,
    params: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
    provider: config.provider ?? modelProvider,
  };
};

describe('normalizeMarketAgentModel', () => {
  describe('should handle undefined and null inputs', () => {
    it('should return empty object when config is undefined', () => {
      const result = normalizeMarketAgentModel(undefined);
      expect(result).toEqual({});
    });

    it('should return config as-is when model is null', () => {
      const config = { model: null, systemRole: 'test-role' };
      const result = normalizeMarketAgentModel(config as any);
      expect(result).toEqual(config);
    });
  });

  describe('should handle model as string', () => {
    it('should return config as-is when model is a string', () => {
      const config = {
        model: 'gpt-4o-mini',
        systemRole: 'You are a helpful assistant',
        provider: 'openai',
      };
      const result = normalizeMarketAgentModel(config);
      expect(result).toEqual(config);
    });

    it('should preserve all config properties when model is string', () => {
      const config = {
        model: 'claude-3-sonnet',
        systemRole: 'You are a coding assistant',
        provider: 'anthropic',
        params: { temperature: 0.7, max_tokens: 2000 },
        plugins: ['web-search', 'calculator'],
      };
      const result = normalizeMarketAgentModel(config);
      expect(result).toEqual(config);
    });
  });

  describe('should normalize model when it is an object', () => {
    it('should extract model name from model object', () => {
      const config = {
        model: {
          model: 'gpt-4o',
          provider: 'openai',
        },
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.model).toBe('gpt-4o');
    });

    it('should set provider from model object when config.provider is not set', () => {
      const config = {
        model: {
          model: 'gpt-4o',
          provider: 'openai',
        },
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.provider).toBe('openai');
    });

    it('should preserve config.provider over model.provider when both exist', () => {
      const config = {
        model: {
          model: 'gpt-4o',
          provider: 'openai',
        },
        provider: 'azure-openai',
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.provider).toBe('azure-openai');
    });

    it('should merge parameters from model object with existing params', () => {
      const config = {
        model: {
          model: 'gpt-4o',
          parameters: { temperature: 0.5, top_p: 0.9 },
        },
        params: { max_tokens: 1000 },
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.params).toEqual({
        temperature: 0.5,
        top_p: 0.9,
        max_tokens: 1000,
      });
    });

    it('should prioritize existing params over model parameters on conflict', () => {
      const config = {
        model: {
          model: 'gpt-4o',
          parameters: { temperature: 0.5, max_tokens: 500 },
        },
        params: { temperature: 0.8, max_tokens: 1000 },
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.params).toEqual({
        temperature: 0.8,
        max_tokens: 1000,
      });
    });

    it('should use model parameters when config.params is undefined', () => {
      const config = {
        model: {
          model: 'claude-3-opus',
          parameters: { temperature: 0.7, max_tokens: 4000 },
        },
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.params).toEqual({
        temperature: 0.7,
        max_tokens: 4000,
      });
    });

    it('should set params to undefined when no parameters exist', () => {
      const config = {
        model: {
          model: 'gpt-4o-mini',
        },
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.params).toBeUndefined();
    });

    it('should preserve other config properties during normalization', () => {
      const config = {
        model: {
          model: 'gpt-4o',
          provider: 'openai',
          parameters: { temperature: 0.6 },
        },
        systemRole: 'You are a helpful assistant',
        plugins: ['web-search'],
        avatar: 'https://example.com/avatar.png',
        enableAgentMode: true,
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result).toMatchObject({
        model: 'gpt-4o',
        provider: 'openai',
        params: { temperature: 0.6 },
        systemRole: 'You are a helpful assistant',
        plugins: ['web-search'],
        avatar: 'https://example.com/avatar.png',
        enableAgentMode: true,
      });
    });
  });

  describe('should handle edge cases', () => {
    it('should handle empty model object', () => {
      const config = {
        model: {} as any,
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config);
      expect(result.model).toBeUndefined();
      expect(result.params).toBeUndefined();
    });

    it('should handle config with only model property', () => {
      const config = {
        model: 'gpt-4o-mini',
      };
      const result = normalizeMarketAgentModel(config);
      expect(result).toEqual(config);
    });

    it('should handle model object without provider', () => {
      const config = {
        model: {
          model: 'custom-model',
          parameters: { temperature: 0.5 },
        },
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.model).toBe('custom-model');
      expect(result.provider).toBeUndefined();
      expect(result.params).toEqual({ temperature: 0.5 });
    });

    it('should handle empty params objects correctly', () => {
      const config = {
        model: {
          model: 'gpt-4o',
          parameters: {},
        },
        params: {},
        systemRole: 'Assistant',
      };
      const result = normalizeMarketAgentModel(config as any);
      expect(result.params).toBeUndefined();
    });

    it('should handle config with undefined model', () => {
      const config = {
        systemRole: 'You are a helpful assistant',
        provider: 'openai',
      };
      const result = normalizeMarketAgentModel(config);
      expect(result).toEqual(config);
    });
  });

  describe('should handle complex real-world scenarios', () => {
    it('should normalize market agent with full configuration', () => {
      const marketConfig = {
        model: {
          model: 'gpt-4o',
          provider: 'openai',
          parameters: {
            temperature: 0.7,
            top_p: 0.95,
            frequency_penalty: 0.5,
          },
        },
        systemRole: 'You are an expert coding assistant specialized in TypeScript',
        params: {
          max_tokens: 4096,
          presence_penalty: 0.2,
        },
        plugins: ['code-interpreter', 'web-search'],
        avatar: 'https://example.com/coding-assistant.png',
        enableAgentMode: true,
      };

      const result = normalizeMarketAgentModel(marketConfig as any);

      expect(result).toEqual({
        model: 'gpt-4o',
        provider: 'openai',
        params: {
          temperature: 0.7,
          top_p: 0.95,
          frequency_penalty: 0.5,
          max_tokens: 4096,
          presence_penalty: 0.2,
        },
        systemRole: 'You are an expert coding assistant specialized in TypeScript',
        plugins: ['code-interpreter', 'web-search'],
        avatar: 'https://example.com/coding-assistant.png',
        enableAgentMode: true,
      });
    });

    it('should handle forked agent configuration', () => {
      const forkedConfig = {
        model: {
          model: 'claude-3-opus',
          provider: 'anthropic',
        },
        provider: 'custom-anthropic-endpoint',
        systemRole: 'Forked assistant',
        params: {
          temperature: 0.9,
        },
      };

      const result = normalizeMarketAgentModel(forkedConfig as any);

      expect(result.provider).toBe('custom-anthropic-endpoint');
      expect(result.model).toBe('claude-3-opus');
    });
  });
});
