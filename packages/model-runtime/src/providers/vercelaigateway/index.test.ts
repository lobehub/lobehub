// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { VercelAIGatewayModelCard } from './index';
import { formatPrice, LobeVercelAIGatewayAI, params } from './index';

testProvider({
  Runtime: LobeVercelAIGatewayAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION',
  chatModel: 'gpt-4o',
  defaultBaseURL: 'https://ai-gateway.vercel.sh/v1',
  invalidErrorType: 'InvalidProviderAPIKey',
  provider: ModelProvider.VercelAIGateway,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeVercelAIGatewayAI - custom features', () => {
  let instance: InstanceType<typeof LobeVercelAIGatewayAI>;

  beforeEach(() => {
    instance = new LobeVercelAIGatewayAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.VercelAIGateway);
      expect(params.baseURL).toBe('https://ai-gateway.vercel.sh/v1');
    });

    it('should have constructor options with default headers', () => {
      expect(params.constructorOptions).toBeDefined();
      expect(params.constructorOptions?.defaultHeaders).toEqual({
        'http-referer': 'https://lobehub.com',
        'x-title': 'LobeHub',
      });
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION;
    });

    it('should disable debug when env is not "1"', () => {
      process.env.DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should add reasoning_effort to providerOptions.openai', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/o1-preview',
        reasoning_effort: 'high',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.providerOptions?.openai?.reasoningEffort).toBe('high');
      expect(calledPayload.providerOptions?.openai?.reasoningSummary).toBe('auto');
    });

    it('should handle both reasoning_effort and verbosity', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/o1-preview',
        reasoning_effort: 'medium',
        verbosity: 'low',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.providerOptions?.openai?.reasoningEffort).toBe('medium');
      expect(calledPayload.providerOptions?.openai?.textVerbosity).toBe('low');
    });

    it('should handle verbosity without reasoning_effort', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/gpt-4o',
        verbosity: 'high',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.providerOptions?.openai?.textVerbosity).toBe('high');
      expect(calledPayload.providerOptions?.openai?.reasoningEffort).toBeUndefined();
    });

    it('should not add providerOptions when no special parameters', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.providerOptions).toEqual({});
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        max_tokens: 1000,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/o1-preview',
        reasoning_effort: 'high',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('openai/o1-preview');
      expect(calledPayload.temperature).toBe(0.7);
      expect(calledPayload.max_tokens).toBe(1000);
      expect(calledPayload.reasoning_effort).toBeUndefined();
    });

    it('should handle different reasoning_effort values', async () => {
      const effortValues = ['low', 'medium', 'high'] as const;

      for (const effort of effortValues) {
        vi.clearAllMocks();
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'openai/o1-preview',
          reasoning_effort: effort,
        } as any);

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.providerOptions?.openai?.reasoningEffort).toBe(effort);
      }
    });
  });

  describe('models function', () => {
    it('should fetch and process models successfully', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          context_window: 128_000,
          description: 'GPT-4o model',
          id: 'gpt-4o',
          max_tokens: 4096,
          name: 'GPT-4o',
          pricing: {
            input: '0.000005',
            output: '0.000015',
          },
          tags: ['tool-use', 'vision'],
          type: 'chat',
        },
        {
          context_window: 200_000,
          id: 'claude-3-5-sonnet',
          name: 'Claude 3.5 Sonnet',
          pricing: {
            input: 0.000_003,
            input_cache_read: 0.000_000_3,
            input_cache_write: 0.000_003_75,
            output: 0.000_015,
          },
          tags: ['reasoning'],
          type: 'chat',
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should handle free models with (free) suffix', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'free-model',
          name: 'Free Model',
          pricing: {
            input: '0',
            output: '0',
          },
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const freeModel = models.find((m) => m.id === 'free-model');

      expect(freeModel).toBeDefined();
      expect(freeModel?.displayName).toContain('(free)');
    });

    it('should handle models with numeric pricing', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'numeric-price-model',
          pricing: {
            input: 0.000_003,
            output: 0.000_015,
          },
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'numeric-price-model');

      expect(model).toBeDefined();
      expect(model?.pricing).toBeDefined();
      expect(model?.pricing?.units).toBeDefined();
      expect(Array.isArray(model?.pricing?.units)).toBe(true);
    });

    it('should map extendParams for gpt-5.x reasoning models', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'openai/gpt-5.2-mini',
          name: 'GPT-5.2 Mini',
          pricing: { input: 0.000_003, output: 0.000_015 },
          tags: ['reasoning'],
          type: 'chat',
        },
        {
          id: 'openai/gpt-5.1-mini',
          name: 'GPT-5.1 Mini',
          pricing: { input: 0.000_003, output: 0.000_015 },
          tags: ['reasoning'],
          type: 'chat',
        },
        {
          id: 'openai/gpt-5-mini',
          name: 'GPT-5 Mini',
          pricing: { input: 0.000_003, output: 0.000_015 },
          tags: ['reasoning'],
          type: 'chat',
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const gpt52 = models.find((m) => m.id === 'openai/gpt-5.2-mini');
      const gpt51 = models.find((m) => m.id === 'openai/gpt-5.1-mini');
      const gpt5 = models.find((m) => m.id === 'openai/gpt-5-mini');

      expect(gpt52?.settings?.extendParams).toEqual(
        expect.arrayContaining(['gpt5_2ReasoningEffort', 'textVerbosity']),
      );
      expect(gpt51?.settings?.extendParams).toEqual(
        expect.arrayContaining(['gpt5_1ReasoningEffort', 'textVerbosity']),
      );
      expect(gpt5?.settings?.extendParams).toEqual(
        expect.arrayContaining(['gpt5ReasoningEffort', 'textVerbosity']),
      );
    });

    it('should handle models with missing pricing', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'no-pricing-model',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'no-pricing-model');

      expect(model).toBeDefined();
      expect((model?.pricing as any)?.input).toBeUndefined();
      expect((model?.pricing as any)?.output).toBeUndefined();
    });

    it('should detect function call capability from tags', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'tool-model',
          tags: ['tool-use'],
        },
        {
          id: 'no-tool-model',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const toolModel = models.find((m) => m.id === 'tool-model');
      const noToolModel = models.find((m) => m.id === 'no-tool-model');

      expect(toolModel?.functionCall).toBe(true);
      expect(noToolModel?.functionCall).toBe(false);
    });

    it('should detect vision capability from tags', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'vision-model',
          tags: ['vision'],
        },
        {
          id: 'no-vision-model',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const visionModel = models.find((m) => m.id === 'vision-model');
      const noVisionModel = models.find((m) => m.id === 'no-vision-model');

      expect(visionModel?.vision).toBe(true);
      expect(noVisionModel?.vision).toBe(false);
    });

    it('should detect reasoning capability from tags', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'reasoning-model',
          tags: ['reasoning'],
        },
        {
          id: 'no-reasoning-model',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const reasoningModel = models.find((m) => m.id === 'reasoning-model');
      const noReasoningModel = models.find((m) => m.id === 'no-reasoning-model');

      expect(reasoningModel?.reasoning).toBe(true);
      expect(noReasoningModel?.reasoning).toBe(false);
    });

    it('should handle embedding type models', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'text-embedding-3-small',
          tags: [],
          type: 'embedding',
        },
        {
          id: 'gpt-4o',
          tags: [],
          type: 'chat',
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const embeddingModel = models.find((m) => m.id === 'text-embedding-3-small');
      const chatModel = models.find((m) => m.id === 'gpt-4o');

      expect(embeddingModel?.type).toBe('embedding');
      expect(chatModel?.type).toBe('chat');
    });

    it('should handle models with cache pricing', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'cache-model',
          pricing: {
            input: '0.000005',
            input_cache_read: '0.0000005',
            input_cache_write: '0.00000625',
            output: '0.000015',
          },
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'cache-model');

      expect(model?.pricing?.units).toBeDefined();
      expect(Array.isArray(model?.pricing?.units)).toBe(true);
      // Check for cache pricing units
      const cacheReadUnit = model?.pricing?.units?.find(
        (u: any) => u.name === 'textInput_cacheRead',
      );
      const cacheWriteUnit = model?.pricing?.units?.find(
        (u: any) => u.name === 'textInput_cacheWrite',
      );
      expect(cacheReadUnit).toBeDefined();
      expect(cacheWriteUnit).toBeDefined();
    });

    it('should handle missing model name with fallback to id', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'model-without-name',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'model-without-name');

      expect(model?.displayName).toBe('model-without-name');
    });

    it('should handle invalid tags (non-array)', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'invalid-tags-model',
          tags: 'not-an-array' as any,
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'invalid-tags-model');

      expect(model?.functionCall).toBe(false);
      expect(model?.vision).toBe(false);
      expect(model?.reasoning).toBe(false);
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: [] }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should handle null model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: null }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should set contextWindowTokens correctly', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          context_window: 128_000,
          id: 'model-with-context',
          tags: [],
        },
        {
          id: 'model-without-context',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const withContext = models.find((m) => m.id === 'model-with-context');
      const withoutContext = models.find((m) => m.id === 'model-without-context');

      expect(withContext?.contextWindowTokens).toBe(128_000);
      expect(withoutContext?.contextWindowTokens).toBeUndefined();
    });

    it('should set maxOutput correctly', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'model-with-max-tokens',
          max_tokens: 4096,
          tags: [],
        },
        {
          id: 'model-with-string-max-tokens',
          max_tokens: '8192' as any,
          tags: [],
        },
        {
          id: 'model-without-max-tokens',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const withMaxTokens = models.find((m) => m.id === 'model-with-max-tokens');
      const withStringMaxTokens = models.find((m) => m.id === 'model-with-string-max-tokens');
      const withoutMaxTokens = models.find((m) => m.id === 'model-without-max-tokens');

      expect(withMaxTokens?.maxOutput).toBe(4096);
      expect(withStringMaxTokens?.maxOutput).toBeUndefined();
      expect(withoutMaxTokens?.maxOutput).toBeUndefined();
    });

    it('should handle invalid pricing values', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'invalid-pricing-model',
          pricing: {
            input: 'not-a-number',
            output: 'also-not-a-number',
          },
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'invalid-pricing-model');

      expect((model?.pricing as any)?.input).toBeUndefined();
      expect((model?.pricing as any)?.output).toBeUndefined();
    });

    it('should handle mixed valid and invalid pricing', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          id: 'mixed-pricing-model',
          pricing: {
            input: '0.000005',
            output: 'invalid',
          },
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'mixed-pricing-model');

      expect(model?.pricing?.units).toBeDefined();
      // Only input should have valid pricing
      const inputUnit = model?.pricing?.units?.find((u: any) => u.name === 'textInput');
      const outputUnit = model?.pricing?.units?.find((u: any) => u.name === 'textOutput');
      expect(inputUnit).toBeDefined();
      expect(outputUnit).toBeUndefined();
    });

    it('should handle created timestamp as number', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          created: 1_700_000_000,
          id: 'model-with-timestamp', // Valid timestamp in 2023
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'model-with-timestamp');

      // processModelCard converts created timestamp to releasedAt (date string)
      expect(model?.releasedAt).toBeDefined();
      expect(typeof model?.releasedAt).toBe('string');
    });

    it('should handle created timestamp as string', async () => {
      const mockModelData: VercelAIGatewayModelCard[] = [
        {
          created: '2024-01-01',
          id: 'model-with-string-timestamp',
          tags: [],
        },
      ];

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModelData }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models.find((m) => m.id === 'model-with-string-timestamp');

      // processModelCard converts created string to releasedAt
      expect(model?.releasedAt).toBe('2024-01-01');
    });

    it('should handle API errors gracefully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('API Error');
    });
  });

  describe('formatPrice utility', () => {
    it('should convert numeric price to per-million tokens', () => {
      const result = formatPrice(0.000_005);
      expect(result).toBe(5);
    });

    it('should convert string price to per-million tokens', () => {
      const result = formatPrice('0.000003');
      expect(result).toBe(3);
    });

    it('should handle zero price', () => {
      const result = formatPrice(0);
      expect(result).toBe(0);
    });

    it('should handle string zero price', () => {
      const result = formatPrice('0');
      expect(result).toBe(0);
    });

    it('should return undefined for undefined', () => {
      const result = formatPrice(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined for null', () => {
      const result = formatPrice(null as any);
      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid string', () => {
      const result = formatPrice('not-a-number');
      expect(result).toBeUndefined();
    });

    it('should handle empty string as zero', () => {
      const result = formatPrice('');
      expect(result).toBe(0);
    });

    it('should handle very small prices with precision', () => {
      const result = formatPrice(0.000_000_1);
      expect(result).toBe(0.1);
    });

    it('should handle large prices', () => {
      const result = formatPrice(0.001);
      expect(result).toBe(1000);
    });

    it('should use 5 significant digits precision', () => {
      const result = formatPrice(0.000_012_345);
      expect(result).toBe(12.345);
    });

    it('should handle scientific notation strings', () => {
      const result = formatPrice('1.5e-5');
      expect(result).toBe(15);
    });
  });
});
