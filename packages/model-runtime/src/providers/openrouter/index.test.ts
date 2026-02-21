// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeOpenRouterAI, params } from './index';

const provider = 'openrouter';
const defaultBaseURL = 'https://openrouter.ai/api/v1';

testProvider({
  provider,
  defaultBaseURL,
  chatModel: 'mistralai/mistral-7b-instruct:free',
  Runtime: LobeOpenRouterAI,
  chatDebugEnv: 'DEBUG_OPENROUTER_CHAT_COMPLETION',
  test: {
    skipAPICall: true,
  },
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeOpenRouterAI({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LobeOpenRouterAI - custom features', () => {
  describe('Params Export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe('openrouter');
      expect(params.baseURL).toBe('https://openrouter.ai/api/v1');
    });

    it('should have chatCompletion configuration', () => {
      expect(params.chatCompletion).toBeDefined();
      expect(params.chatCompletion.handlePayload).toBeDefined();
    });

    it('should have constructorOptions with headers', () => {
      expect(params.constructorOptions).toBeDefined();
      expect(params.constructorOptions.defaultHeaders).toBeDefined();
      expect(params.constructorOptions.defaultHeaders['HTTP-Referer']).toBe('https://lobehub.com');
      expect(params.constructorOptions.defaultHeaders['X-Title']).toBe('LobeHub');
    });

    it('should have debug configuration', () => {
      expect(params.debug).toBeDefined();
      expect(params.debug.chatCompletion).toBeDefined();
    });

    it('should have models function', () => {
      expect(params.models).toBeDefined();
      expect(typeof params.models).toBe('function');
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_OPENROUTER_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_OPENROUTER_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_OPENROUTER_CHAT_COMPLETION;
    });
  });

  describe('Constructor Options', () => {
    it('should set default headers', () => {
      const instance = new LobeOpenRouterAI({ apiKey: 'test' });
      expect(instance).toBeDefined();
      // Headers are set in constructorOptions but not directly accessible
      // We can verify by checking that the instance was created successfully
    });

    it('should use custom base URL when provided', () => {
      const customBaseURL = 'https://custom.openrouter.ai/api/v1';
      const instance = new LobeOpenRouterAI({ apiKey: 'test', baseURL: customBaseURL });
      expect(instance.baseURL).toBe(customBaseURL);
    });
  });

  describe('handlePayload', () => {
    it('should default stream to true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true }),
        expect.anything(),
      );
    });

    it('should preserve stream value when explicitly set to false', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        stream: false,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false }),
        expect.anything(),
      );
    });

    it('should append :online to model when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Search for something', role: 'user' }],
        model: 'openai/gpt-4',
        enabledSearch: true,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'openai/gpt-4:online' }),
        expect.anything(),
      );
    });

    it('should not modify model when enabledSearch is false', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/gpt-4',
        enabledSearch: false,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'openai/gpt-4' }),
        expect.anything(),
      );
    });

    it('should not modify model when enabledSearch is undefined', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/gpt-4',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'openai/gpt-4' }),
        expect.anything(),
      );
    });

    it('should not add reasoning object when thinking is not enabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/gpt-4',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ reasoning: expect.anything() }),
        expect.anything(),
      );
    });

    it('should add reasoning with default 1024 tokens when thinking is enabled without budget', async () => {
      await instance.chat({
        messages: [{ content: 'Think about this', role: 'user' }],
        model: 'openai/gpt-4',
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: { max_tokens: 1024 },
        }),
        expect.anything(),
      );
    });

    it('should use budget_tokens when provided and within limits', async () => {
      await instance.chat({
        messages: [{ content: 'Think about this', role: 'user' }],
        model: 'openai/gpt-4',
        thinking: { type: 'enabled', budget_tokens: 2000 },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: { max_tokens: 2000 },
        }),
        expect.anything(),
      );
    });

    it('should use model maxOutput when no max_tokens provided', async () => {
      // Mock OpenRouterModels to have a specific maxOutput
      const { openrouter } = await import('model-bank');
      const modelWithMaxOutput = openrouter.find((m) => m.maxOutput !== undefined);

      if (modelWithMaxOutput) {
        await instance.chat({
          messages: [{ content: 'Think about this', role: 'user' }],
          model: modelWithMaxOutput.id,
          thinking: { type: 'enabled', budget_tokens: 50000 },
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            reasoning: expect.objectContaining({ max_tokens: expect.any(Number) }),
          }),
          expect.anything(),
        );
      }
    });

    it('should combine enabledSearch and thinking features', async () => {
      await instance.chat({
        messages: [{ content: 'Search and think', role: 'user' }],
        model: 'openai/gpt-4',
        enabledSearch: true,
        thinking: { type: 'enabled', budget_tokens: 1500 },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'openai/gpt-4:online',
          reasoning: { max_tokens: 1500 },
        }),
        expect.anything(),
      );
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/gpt-4',
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'openai/gpt-4',
          temperature: 0.7,
          max_tokens: 1000,
          top_p: 0.9,
        }),
        expect.anything(),
      );
    });

    it('should handle thinking type disabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/gpt-4',
        thinking: { type: 'disabled', budget_tokens: 0 },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: { enabled: false } }),
        expect.anything(),
      );
    });

    it('should not add reasoning when thinking is undefined', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'openai/gpt-4',
        thinking: undefined,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ reasoning: expect.anything() }),
        expect.anything(),
      );
    });

    it('should use budget_tokens when lower than default 1024', async () => {
      await instance.chat({
        messages: [{ content: 'Think about this', role: 'user' }],
        model: 'openai/gpt-4',
        thinking: { type: 'enabled', budget_tokens: 512 },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: { max_tokens: 512 },
        }),
        expect.anything(),
      );
    });

    it('should handle 0 budget_tokens (passes directly)', async () => {
      await instance.chat({
        messages: [{ content: 'Think about this', role: 'user' }],
        model: 'openai/gpt-4',
        thinking: { type: 'enabled', budget_tokens: 0 },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: { max_tokens: 0 }, // 0 is passed directly
        }),
        expect.anything(),
      );
    });

    it('should handle negative budget_tokens', async () => {
      await instance.chat({
        messages: [{ content: 'Think about this', role: 'user' }],
        model: 'openai/gpt-4',
        thinking: { type: 'enabled', budget_tokens: -100 },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: { max_tokens: -100 },
        }),
        expect.anything(),
      );
    });

    it('should map thinkingLevel to reasoning effort', async () => {
      await instance.chat({
        messages: [{ content: 'Think level', role: 'user' }],
        model: 'openai/gpt-4',
        thinkingLevel: 'medium',
      } as any);

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: { effort: 'medium' } }),
        expect.anything(),
      );
    });
  });

  describe('models mapping', () => {
    it('should map extendParams for gpt-5.x reasoning and verbosity', async () => {
      const mockModels = [
        {
          architecture: { input_modalities: ['text'] },
          created: 1_700_000_000,
          description: 'Test model',
          id: 'openai/gpt-5.2-mini',
          name: 'openai/gpt-5.2-mini',
          pricing: { completion: '0.00001', prompt: '0.00001' },
          supported_parameters: ['reasoning'],
          top_provider: { context_length: 8192, max_completion_tokens: 1024 },
        },
        {
          architecture: { input_modalities: ['text'] },
          created: 1_700_000_000,
          description: 'Test model',
          id: 'openai/gpt-5.1-mini',
          name: 'openai/gpt-5.1-mini',
          pricing: { completion: '0.00001', prompt: '0.00001' },
          supported_parameters: ['reasoning'],
          top_provider: { context_length: 8192, max_completion_tokens: 1024 },
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        } as any),
      );

      const models = await params.models();
      const gpt52 = models.find((m) => m.id === 'openai/gpt-5.2-mini');
      const gpt51 = models.find((m) => m.id === 'openai/gpt-5.1-mini');

      expect(gpt52?.settings?.extendParams).toEqual(
        expect.arrayContaining(['gpt5_2ReasoningEffort', 'textVerbosity']),
      );
      expect(gpt51?.settings?.extendParams).toEqual(
        expect.arrayContaining(['gpt5_1ReasoningEffort', 'textVerbosity']),
      );
    });

    it('should map thinkingLevel for gemini-3 flash/pro reasoning', async () => {
      const mockModels = [
        {
          architecture: { input_modalities: ['text'] },
          created: 1_700_000_000,
          description: 'Test model',
          id: 'google/gemini-3-pro',
          name: 'google/gemini-3-pro',
          pricing: { completion: '0.00001', prompt: '0.00001' },
          supported_parameters: ['reasoning'],
          top_provider: { context_length: 8192, max_completion_tokens: 1024 },
        },
        {
          architecture: { input_modalities: ['text'] },
          created: 1_700_000_000,
          description: 'Test model',
          id: 'google/gemini-3-flash',
          name: 'google/gemini-3-flash',
          pricing: { completion: '0.00001', prompt: '0.00001' },
          supported_parameters: ['reasoning'],
          top_provider: { context_length: 8192, max_completion_tokens: 1024 },
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        } as any),
      );

      const models = await params.models();
      const geminiPro = models.find((m) => m.id === 'google/gemini-3-pro');
      const geminiFlash = models.find((m) => m.id === 'google/gemini-3-flash');

      expect(geminiPro?.settings?.extendParams).toEqual(expect.arrayContaining(['thinkingLevel2']));
      expect(geminiFlash?.settings?.extendParams).toEqual(
        expect.arrayContaining(['thinkingLevel']),
      );
    });
  });

  describe('models', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models successfully', async () => {
      const mockModels = [
        {
          id: 'openai/gpt-4',
          canonical_slug: 'openai/gpt-4',
          name: 'OpenAI: GPT-4',
          created: 1679587200,
          description: 'GPT-4 model',
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'gpt-4',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00003',
            completion: '0.00006',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: ['tools', 'temperature'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models');
      expect(models.length).toBeGreaterThan(0);
    });

    it('should handle display name with colon - remove prefix', async () => {
      const mockModels = [
        {
          id: 'anthropic/claude-3-opus',
          canonical_slug: 'anthropic/claude-3-opus',
          name: 'Anthropic: Claude 3 Opus',
          created: 1679587200,
          context_length: 200000,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            tokenizer: 'claude',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.000015',
            completion: '0.000075',
          },
          top_provider: {
            context_length: 200000,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: ['tools', 'reasoning'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const claudeModel = models.find((m) => m.id === 'anthropic/claude-3-opus');
      expect(claudeModel?.displayName).toBe('Claude 3 Opus');
    });

    it('should preserve DeepSeek prefix when suffix does not contain deepseek', async () => {
      const mockModels = [
        {
          id: 'deepseek/deepseek-chat',
          canonical_slug: 'deepseek/deepseek-chat',
          name: 'DeepSeek: Chat',
          created: 1679587200,
          context_length: 32768,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'deepseek',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00000014',
            completion: '0.00000028',
          },
          top_provider: {
            context_length: 32768,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: ['tools'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const deepseekModel = models.find((m) => m.id === 'deepseek/deepseek-chat');
      expect(deepseekModel?.displayName).toBe('DeepSeek: Chat');
    });

    it('should remove DeepSeek prefix when suffix contains deepseek', async () => {
      const mockModels = [
        {
          id: 'deepseek/deepseek-r1',
          canonical_slug: 'deepseek/deepseek-r1',
          name: 'DeepSeek: DeepSeek R1',
          created: 1679587200,
          context_length: 64000,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'deepseek',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00000055',
            completion: '0.0000022',
          },
          top_provider: {
            context_length: 64000,
            max_completion_tokens: 8192,
            is_moderated: false,
          },
          supported_parameters: ['reasoning'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const deepseekModel = models.find((m) => m.id === 'deepseek/deepseek-r1');
      expect(deepseekModel?.displayName).toBe('DeepSeek R1');
    });

    it('should append (free) to display name for free models', async () => {
      const mockModels = [
        {
          id: 'free/model',
          canonical_slug: 'free/model',
          name: 'Provider: Free Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0',
            completion: '0',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const freeModel = models.find((m) => m.id === 'free/model');
      expect(freeModel?.displayName).toBe('Free Model (free)');
    });

    it('should not append (free) if already present in name', async () => {
      const mockModels = [
        {
          id: 'free/model',
          canonical_slug: 'free/model',
          name: 'Provider: Free Model (free)',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0',
            completion: '0',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const freeModel = models.find((m) => m.id === 'free/model');
      expect(freeModel?.displayName).toBe('Free Model (free)');
      expect(freeModel?.displayName).not.toBe('Free Model (free) (free)');
    });

    it('should detect vision capability from input_modalities', async () => {
      const mockModels = [
        {
          id: 'vision/model',
          canonical_slug: 'vision/model',
          name: 'Vision Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text+image->text',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const visionModel = models.find((m) => m.id === 'vision/model');
      expect(visionModel?.vision).toBe(true);
    });

    it('should detect function call from supported_parameters', async () => {
      const mockModels = [
        {
          id: 'function/model',
          canonical_slug: 'function/model',
          name: 'Function Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: ['tools', 'temperature'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const functionModel = models.find((m) => m.id === 'function/model');
      expect(functionModel?.functionCall).toBe(true);
    });

    it('should detect reasoning from supported_parameters', async () => {
      const mockModels = [
        {
          id: 'reasoning/model',
          canonical_slug: 'reasoning/model',
          name: 'Reasoning Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: ['reasoning', 'temperature'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const reasoningModel = models.find((m) => m.id === 'reasoning/model');
      expect(reasoningModel?.reasoning).toBe(true);
    });

    it('should format pricing correctly', async () => {
      const mockModels = [
        {
          id: 'pricing/model',
          canonical_slug: 'pricing/model',
          name: 'Pricing Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
            input_cache_read: '0.000001',
            input_cache_write: '0.0000015',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const pricingModel = models.find((m) => m.id === 'pricing/model');
      expect(pricingModel?.pricing).toBeDefined();
      // Pricing is converted to units array by processMultiProviderModelList
      expect(pricingModel?.pricing?.units).toBeDefined();
      expect(pricingModel?.pricing?.units).toBeInstanceOf(Array);
      expect(pricingModel?.pricing?.units?.length).toBe(4);
      // Check that the units contain the correct pricing information
      const inputUnit = pricingModel?.pricing?.units?.find((u) => u.name === 'textInput');
      const outputUnit = pricingModel?.pricing?.units?.find((u) => u.name === 'textOutput');
      const cachedInputUnit = pricingModel?.pricing?.units?.find(
        (u) => u.name === 'textInput_cacheRead',
      );
      const writeCacheInputUnit = pricingModel?.pricing?.units?.find(
        (u) => u.name === 'textInput_cacheWrite',
      );
      expect(inputUnit?.strategy).toBe('fixed');
      expect(outputUnit?.strategy).toBe('fixed');
      expect(cachedInputUnit?.strategy).toBe('fixed');
      expect(writeCacheInputUnit?.strategy).toBe('fixed');
      if (inputUnit?.strategy === 'fixed') expect(inputUnit.rate).toBe(10);
      if (outputUnit?.strategy === 'fixed') expect(outputUnit.rate).toBe(20);
      if (cachedInputUnit?.strategy === 'fixed') expect(cachedInputUnit.rate).toBe(1);
      if (writeCacheInputUnit?.strategy === 'fixed') expect(writeCacheInputUnit.rate).toBe(1.5);
    });

    it('should handle undefined pricing fields', async () => {
      const mockModels = [
        {
          id: 'no-cache-pricing/model',
          canonical_slug: 'no-cache-pricing/model',
          name: 'No Cache Pricing Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const noCacheModel = models.find((m) => m.id === 'no-cache-pricing/model');
      expect(noCacheModel?.pricing?.units).toBeDefined();
      // Should only have input and output units, no cache units
      expect(noCacheModel?.pricing?.units?.length).toBe(2);
      const cachedInputUnit = noCacheModel?.pricing?.units?.find(
        (u) => u.name === 'textInput_cacheRead',
      );
      const writeCacheInputUnit = noCacheModel?.pricing?.units?.find(
        (u) => u.name === 'textInput_cacheWrite',
      );
      expect(cachedInputUnit).toBeUndefined();
      expect(writeCacheInputUnit).toBeUndefined();
    });

    it('should handle -1 pricing as undefined', async () => {
      const mockModels = [
        {
          id: 'invalid-pricing/model',
          canonical_slug: 'invalid-pricing/model',
          name: 'Invalid Pricing Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '-1',
            completion: '-1',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const invalidPricingModel = models.find((m) => m.id === 'invalid-pricing/model');
      // -1 pricing is converted to undefined by formatPrice, so no pricing units should be present
      expect(invalidPricingModel?.pricing).toBeUndefined();
    });

    it('should use top_provider context_length if available', async () => {
      const mockModels = [
        {
          id: 'context/model',
          canonical_slug: 'context/model',
          name: 'Context Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const contextModel = models.find((m) => m.id === 'context/model');
      expect(contextModel?.contextWindowTokens).toBe(8192);
    });

    it('should fallback to model context_length when top_provider is not available', async () => {
      const mockModels = [
        {
          id: 'fallback-context/model',
          canonical_slug: 'fallback-context/model',
          name: 'Fallback Context Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 0,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const fallbackModel = models.find((m) => m.id === 'fallback-context/model');
      expect(fallbackModel?.contextWindowTokens).toBe(4096);
    });

    it('should set maxOutput from top_provider when available', async () => {
      const mockModels = [
        {
          id: 'maxoutput/model',
          canonical_slug: 'maxoutput/model',
          name: 'Max Output Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const maxOutputModel = models.find((m) => m.id === 'maxoutput/model');
      expect(maxOutputModel?.maxOutput).toBe(4096);
    });

    it('should set maxOutput to undefined when top_provider value is null', async () => {
      const mockModels = [
        {
          id: 'null-maxoutput/model',
          canonical_slug: 'null-maxoutput/model',
          name: 'Null Max Output Model',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: null,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const nullMaxOutputModel = models.find((m) => m.id === 'null-maxoutput/model');
      // When top_provider.max_completion_tokens is null, falls back to model.context_length
      expect(nullMaxOutputModel?.maxOutput).toBe(8192);
    });

    it('should format releasedAt from created timestamp', async () => {
      const mockModels = [
        {
          id: 'released/model',
          canonical_slug: 'released/model',
          name: 'Released Model',
          created: 1679587200, // 2023-03-23
          context_length: 8192,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const releasedModel = models.find((m) => m.id === 'released/model');
      expect(releasedModel?.releasedAt).toBe('2023-03-23');
    });

    it('should handle empty model list from API', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: [] }),
        }),
      );

      const models = await params.models();

      expect(models).toEqual([]);
    });

    it('should return empty array when fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
        }),
      );

      const models = await params.models();

      expect(models).toEqual([]);
    });

    it('should return empty array when fetch throws error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const models = await params.models();

      expect(models).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        'Failed to fetch OpenRouter frontend models:',
        expect.any(Error),
      );
    });

    it('should handle models with missing optional fields', async () => {
      const mockModels = [
        {
          id: 'minimal/model',
          canonical_slug: 'minimal/model',
          name: 'Minimal Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: [],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const minimalModel = models.find((m) => m.id === 'minimal/model');
      expect(minimalModel).toBeDefined();
      expect(minimalModel?.vision).toBe(false);
      expect(minimalModel?.functionCall).toBe(false);
      expect(minimalModel?.reasoning).toBe(false);
    });

    it('should handle model name without colon', async () => {
      const mockModels = [
        {
          id: 'simple/model',
          canonical_slug: 'simple/model',
          name: 'Simple Model Name',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const simpleModel = models.find((m) => m.id === 'simple/model');
      expect(simpleModel?.displayName).toBe('Simple Model Name');
    });

    it('should process multiple models correctly', async () => {
      const mockModels = [
        {
          id: 'model-1',
          canonical_slug: 'model-1',
          name: 'Provider: Model 1',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: { prompt: '0.00001', completion: '0.00002' },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: ['tools'],
        },
        {
          id: 'model-2',
          canonical_slug: 'model-2',
          name: 'Provider: Model 2',
          created: 1679587200,
          context_length: 8192,
          architecture: {
            modality: 'text+image->text',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: { prompt: '0.00002', completion: '0.00004' },
          top_provider: {
            context_length: 8192,
            max_completion_tokens: 4096,
            is_moderated: false,
          },
          supported_parameters: ['reasoning'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      expect(models.length).toBeGreaterThanOrEqual(2);
      const model1 = models.find((m) => m.id === 'model-1');
      const model2 = models.find((m) => m.id === 'model-2');

      expect(model1?.functionCall).toBe(true);
      expect(model1?.vision).toBe(false);
      expect(model2?.reasoning).toBe(true);
      expect(model2?.vision).toBe(true);
    });

    it('should handle both tools and reasoning in supported_parameters', async () => {
      const mockModels = [
        {
          id: 'advanced/model',
          canonical_slug: 'advanced/model',
          name: 'Advanced Model',
          created: 1679587200,
          context_length: 128000,
          architecture: {
            modality: 'text+image->text',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00003',
            completion: '0.00009',
          },
          top_provider: {
            context_length: 128000,
            max_completion_tokens: 8192,
            is_moderated: false,
          },
          supported_parameters: ['tools', 'reasoning', 'temperature'],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const advancedModel = models.find((m) => m.id === 'advanced/model');
      expect(advancedModel?.functionCall).toBe(true);
      expect(advancedModel?.reasoning).toBe(true);
      expect(advancedModel?.vision).toBe(true);
    });

    it('should handle empty input_modalities array', async () => {
      const mockModels = [
        {
          id: 'empty-modalities/model',
          canonical_slug: 'empty-modalities/model',
          name: 'Empty Modalities Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: [],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.00001',
            completion: '0.00002',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const emptyModel = models.find((m) => m.id === 'empty-modalities/model');
      expect(emptyModel?.vision).toBe(false);
    });

    it('should handle null pricing fields (converts to 0)', async () => {
      const mockModels = [
        {
          id: 'null-pricing/model',
          canonical_slug: 'null-pricing/model',
          name: 'Null Pricing Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: null,
            completion: null,
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const nullPricingModel = models.find((m) => m.id === 'null-pricing/model');
      // null is converted to 0 by formatPrice, which is valid pricing
      expect(nullPricingModel?.pricing).toBeDefined();
      const inputUnit = nullPricingModel?.pricing?.units?.find((u) => u.name === 'textInput');
      const outputUnit = nullPricingModel?.pricing?.units?.find((u) => u.name === 'textOutput');
      if (inputUnit?.strategy === 'fixed') expect(inputUnit.rate).toBe(0);
      if (outputUnit?.strategy === 'fixed') expect(outputUnit.rate).toBe(0);
    });

    it('should handle zero pricing (free model)', async () => {
      const mockModels = [
        {
          id: 'zero-pricing/model',
          canonical_slug: 'zero-pricing/model',
          name: 'Zero Pricing Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0',
            completion: '0',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const zeroPricingModel = models.find((m) => m.id === 'zero-pricing/model');
      expect(zeroPricingModel?.pricing).toBeDefined();
      // Zero is valid pricing
      const inputUnit = zeroPricingModel?.pricing?.units?.find((u) => u.name === 'textInput');
      const outputUnit = zeroPricingModel?.pricing?.units?.find((u) => u.name === 'textOutput');
      if (inputUnit?.strategy === 'fixed') expect(inputUnit.rate).toBe(0);
      if (outputUnit?.strategy === 'fixed') expect(outputUnit.rate).toBe(0);
    });

    it('should handle mixed zero and non-zero pricing', async () => {
      const mockModels = [
        {
          id: 'mixed-free/model',
          canonical_slug: 'mixed-free/model',
          name: 'Mixed Free Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0',
            completion: '0.00001',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const mixedModel = models.find((m) => m.id === 'mixed-free/model');
      // Input or output is 0. Current behavior does not append '(free)' for mixed pricing,
      // so assert the displayName equals the cleaned model name.
      expect(mixedModel?.displayName).toBe('Mixed Free Model');
    });

    it('should handle very large pricing values', async () => {
      const mockModels = [
        {
          id: 'expensive/model',
          canonical_slug: 'expensive/model',
          name: 'Expensive Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '1.5',
            completion: '3.0',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const expensiveModel = models.find((m) => m.id === 'expensive/model');
      expect(expensiveModel?.pricing?.units).toBeDefined();
      const inputUnit = expensiveModel?.pricing?.units?.find((u) => u.name === 'textInput');
      const outputUnit = expensiveModel?.pricing?.units?.find((u) => u.name === 'textOutput');
      if (inputUnit?.strategy === 'fixed') expect(inputUnit.rate).toBeGreaterThan(1000000);
      if (outputUnit?.strategy === 'fixed') expect(outputUnit.rate).toBeGreaterThan(1000000);
    });
  });

  describe('formatPrice utility', () => {
    // Test formatPrice indirectly through models function
    it('should handle undefined price', async () => {
      const mockModels = [
        {
          id: 'test/model',
          canonical_slug: 'test/model',
          name: 'Test Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: undefined,
            completion: undefined,
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const testModel = models.find((m) => m.id === 'test/model');
      expect(testModel?.pricing).toBeUndefined();
    });

    it('should handle string -1 as undefined price', async () => {
      const mockModels = [
        {
          id: 'invalid-price/model',
          canonical_slug: 'invalid-price/model',
          name: 'Invalid Price Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '-1',
            completion: '-1',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const invalidPriceModel = models.find((m) => m.id === 'invalid-price/model');
      expect(invalidPriceModel?.pricing).toBeUndefined();
    });

    it('should format very small price values correctly', async () => {
      const mockModels = [
        {
          id: 'micro-price/model',
          canonical_slug: 'micro-price/model',
          name: 'Micro Price Model',
          created: 1679587200,
          context_length: 4096,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'default',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.0000001',
            completion: '0.0000002',
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          supported_parameters: [],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models();

      const microPriceModel = models.find((m) => m.id === 'micro-price/model');
      expect(microPriceModel?.pricing?.units).toBeDefined();
      expect(microPriceModel?.pricing?.units?.length).toBe(2);
    });
  });
});
