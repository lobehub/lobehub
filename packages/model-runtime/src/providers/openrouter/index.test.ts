// @vitest-environment node
import { validateModelParamsSchema } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { LobeOpenRouterAI, params } from './index';
import type { OpenRouterImageModelCard } from './type';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

const mockChatCatalogResponse = (response: {
  json?: () => Promise<unknown>;
  ok: boolean;
  status?: number;
}) =>
  vi
    .fn()
    .mockResolvedValueOnce(response)
    .mockResolvedValue({
      json: async () => ({ data: [] }),
      ok: true,
    });

const imageModel = (
  overrides: Partial<OpenRouterImageModelCard> = {},
): OpenRouterImageModelCard => ({
  architecture: { input_modalities: ['text'], output_modalities: ['image'] },
  created: 1_700_000_000,
  description: 'An image generation model',
  endpoints: '/api/v1/images/models/new-provider/new-model/endpoints',
  id: 'new-provider/new-model',
  name: 'New image model',
  supported_parameters: {},
  supports_streaming: false,
  ...overrides,
});

const mockCatalogs = (images: OpenRouterImageModelCard[], chat: unknown[] = []) => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ json: async () => ({ data: chat }), ok: true })
    .mockResolvedValueOnce({ json: async () => ({ data: images }), ok: true });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

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
    it('should have constructorOptions with headers', () => {
      expect(params.constructorOptions).toBeDefined();
      expect(params.constructorOptions.defaultHeaders).toBeDefined();
      expect(params.constructorOptions.defaultHeaders['HTTP-Referer']).toBe('https://lobehub.com');
      expect(params.constructorOptions.defaultHeaders['X-Title']).toBe('LobeHub');
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

    describe('image model handling', () => {
      it('should add modalities for model with -image suffix', async () => {
        await instance.chat({
          messages: [{ content: 'Generate an image', role: 'user' }],
          model: 'openai/dall-e-3-image',
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            modalities: ['image', 'text'],
          }),
          expect.anything(),
        );
      });

      it('should add modalities for model with flux in name', async () => {
        await instance.chat({
          messages: [{ content: 'Generate an image', role: 'user' }],
          model: 'black-forest-labs/flux-pro',
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            modalities: ['image', 'text'],
          }),
          expect.anything(),
        );
      });

      it('should not add modalities for non-image model', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'openai/gpt-4',
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.not.objectContaining({
            modalities: expect.anything(),
          }),
          expect.anything(),
        );
      });

      it('should add image_config with aspect_ratio for image model', async () => {
        await instance.chat({
          messages: [{ content: 'Generate an image', role: 'user' }],
          model: 'openai/dall-e-3-image',
          imageAspectRatio: '16:9',
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            modalities: ['image', 'text'],
            image_config: { aspect_ratio: '16:9' },
          }),
          expect.anything(),
        );
      });

      it('should add image_config with image_size for image model', async () => {
        await instance.chat({
          messages: [{ content: 'Generate an image', role: 'user' }],
          model: 'openai/dall-e-3-image',
          imageResolution: '4K',
        } as any);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            modalities: ['image', 'text'],
            image_config: { image_size: '4K' },
          }),
          expect.anything(),
        );
      });

      it("should map '512' to '0.5K' in image_config.image_size", async () => {
        await instance.chat({
          messages: [{ content: 'Generate an image', role: 'user' }],
          model: 'openai/dall-e-3-image',
          imageResolution: '512',
        } as any);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            modalities: ['image', 'text'],
            image_config: { image_size: '0.5K' },
          }),
          expect.anything(),
        );
      });

      it('should combine aspect_ratio and image_size in image_config', async () => {
        await instance.chat({
          messages: [{ content: 'Generate an image', role: 'user' }],
          model: 'openai/dall-e-3-image',
          imageAspectRatio: '16:9',
          imageResolution: '2K',
        } as any);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            modalities: ['image', 'text'],
            image_config: { aspect_ratio: '16:9', image_size: '2K' },
          }),
          expect.anything(),
        );
      });

      it('should omit aspect_ratio when imageAspectRatio is auto', async () => {
        await instance.chat({
          messages: [{ content: 'Generate an image', role: 'user' }],
          model: 'openai/dall-e-3-image',
          imageAspectRatio: 'auto',
          imageResolution: '2K',
        } as any);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            modalities: ['image', 'text'],
            image_config: { image_size: '2K' },
          }),
          expect.anything(),
        );
      });
    });
  });

  describe('models mapping', () => {
    it('should map extendParams for gpt-5.x reasoning and verbosity', async () => {
      const mockModels = [
        {
          architecture: { input_modalities: ['text'] },
          created: 1_700_000_000,
          description: 'Test model',
          id: 'openai/gpt-5.5',
          name: 'openai/gpt-5.5',
          pricing: { completion: '0.00001', prompt: '0.00001' },
          supported_parameters: ['reasoning'],
          top_provider: { context_length: 8192, max_completion_tokens: 1024 },
        },
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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        } as any),
      );

      const models = await params.models({ client: instance['client'] });
      const gpt55 = models.find((m) => m.id === 'openai/gpt-5.5');
      const gpt52 = models.find((m) => m.id === 'openai/gpt-5.2-mini');
      const gpt51 = models.find((m) => m.id === 'openai/gpt-5.1-mini');

      expect(gpt55?.settings?.extendParams).toEqual(
        expect.arrayContaining(['gpt5_2ReasoningEffort', 'textVerbosity']),
      );
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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        } as any),
      );

      const models = await params.models({ client: instance['client'] });
      const geminiPro = models.find((m) => m.id === 'google/gemini-3-pro');
      const geminiFlash = models.find((m) => m.id === 'google/gemini-3-flash');

      expect(geminiPro?.settings?.extendParams).toEqual(expect.arrayContaining(['thinkingLevel2']));
      expect(geminiFlash?.settings?.extendParams).toEqual(
        expect.arrayContaining(['thinkingLevel']),
      );
    });
  });

  describe('dedicated image models', () => {
    it('retains unknown image IDs with a valid prompt-only schema', async () => {
      const fetchMock = mockCatalogs([imageModel()]);

      const models = await instance.models();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/images/models',
        expect.anything(),
      );
      expect(models).toEqual([
        expect.objectContaining({
          displayName: 'New image model',
          id: 'new-provider/new-model',
          parameters: { prompt: { default: '' } },
          type: 'image',
        }),
      ]);
      expect(() => validateModelParamsSchema(models[0].parameters)).not.toThrow();
    });

    it('merges the catalogs with image metadata winning duplicate IDs and chat retained', async () => {
      const chatModel = {
        architecture: { input_modalities: ['text'] },
        created: 1_700_000_000,
        id: 'openai/gpt-4',
        name: 'OpenAI: GPT-4',
        pricing: { completion: '0.00002', prompt: '0.00001' },
        supported_parameters: ['tools'],
        top_provider: { context_length: 8192, max_completion_tokens: 1024 },
      };
      mockCatalogs(
        [imageModel({ id: 'google/gemini-3.1-flash-image', supported_parameters: {} })],
        [chatModel, { ...chatModel, id: 'google/gemini-3.1-flash-image' }],
      );

      const models = await instance.models();

      expect(models).toHaveLength(2);
      expect(models.find((model) => model.id === 'openai/gpt-4')).toMatchObject({
        contextWindowTokens: 8192,
        displayName: 'GPT-4',
        functionCall: true,
        type: 'chat',
      });
      expect(models.find((model) => model.id === 'google/gemini-3.1-flash-image')).toMatchObject({
        displayName: 'New image model',
        parameters: { prompt: { default: '' } },
        type: 'image',
      });
      expect(models.find((model) => model.type === 'image')?.parameters).toEqual({
        prompt: { default: '' },
      });
    });

    it('translates advertised enum and range controls without adding unsupported knobs', async () => {
      mockCatalogs([
        imageModel({
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
          supported_parameters: {
            aspect_ratio: { type: 'enum', values: ['16:9', '1:1'] },
            background: { type: 'enum', values: ['transparent'] },
            input_references: { max: 10, min: 0, type: 'range' },
            n: { max: 10, min: 1, type: 'range' },
            output_compression: { max: 100, min: 0, type: 'range' },
            quality: { type: 'enum', values: ['high', 'medium'] },
            resolution: { type: 'enum', values: ['2K', '4K'] },
            seed: { max: 1000, min: 10, type: 'range' },
            size: { type: 'enum', values: ['2048x2048', '4096x4096'] },
            stream: { type: 'boolean' },
          },
        }),
      ]);

      const models = await params.models({ client: instance['client'] });

      expect(models[0].parameters).toEqual({
        aspectRatio: { default: '16:9', enum: ['16:9', '1:1'] },
        imageUrls: { default: [], maxCount: 10 },
        prompt: { default: '' },
        quality: { default: 'high', enum: ['high', 'medium'] },
        resolution: { default: '2K', enum: ['2K', '4K'] },
        seed: { default: null, max: 1000, min: 10 },
        size: { default: '2048x2048', enum: ['2048x2048', '4096x4096'] },
      });
      expect(() => validateModelParamsSchema(models[0].parameters)).not.toThrow();
    });

    it('interprets boolean seed descriptors as parameter availability rather than a boolean value', async () => {
      mockCatalogs([imageModel({ supported_parameters: { seed: { type: 'boolean' } } })]);

      const models = await params.models({ client: instance['client'] });

      expect(models[0].parameters).toEqual({ prompt: { default: '' }, seed: { default: null } });
    });

    it('only exposes references when input modalities include image', async () => {
      mockCatalogs([
        imageModel({
          supported_parameters: { input_references: { type: 'boolean' } },
        }),
        imageModel({
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
          id: 'new-provider/image-input',
        }),
      ]);

      const models = await params.models({ client: instance['client'] });

      expect(models[0].parameters).toEqual({ prompt: { default: '' } });
      expect(models[1].parameters?.imageUrls).toEqual({ default: [], maxCount: 16 });
    });

    it('omits empty enum descriptors and incompatible descriptor types', async () => {
      mockCatalogs([
        imageModel({
          supported_parameters: {
            aspect_ratio: { type: 'enum', values: [] },
            quality: { type: 'boolean' },
            resolution: { max: 4, min: 1, type: 'range' },
            seed: { type: 'enum', values: ['random'] },
          },
        }),
      ]);

      const models = await params.models({ client: instance['client'] });

      expect(models[0].parameters).toEqual({ prompt: { default: '' } });
    });

    it('authenticates both catalogs with configured gateway headers and fetch', async () => {
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init);
        if (
          request.headers.get('authorization') !== 'Bearer gateway-key' ||
          request.headers.get('x-gateway') !== 'gateway-value'
        ) {
          return Response.json({ error: { message: 'Authentication required' } }, { status: 401 });
        }
        expect(request.headers.get('x-title')).toBe('Gateway App');
        return Response.json({
          data: request.url.endsWith('/images/models') ? [imageModel()] : [],
        });
      });
      const customInstance = new LobeOpenRouterAI({
        apiKey: 'gateway-key',
        baseURL: 'https://proxy.example/api/v1/',
        defaultHeaders: { 'X-Gateway': 'gateway-value', 'X-Title': 'Gateway App' },
        fetch: fetchMock,
      });

      const models = await customInstance.models();

      expect(models.find((model) => model.id === 'new-provider/new-model')?.type).toBe('image');
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        'https://proxy.example/api/v1/models',
        'https://proxy.example/api/v1/images/models',
      ]);
    });

    it('reports an unsuccessful image catalog request', async () => {
      const fetchMock = mockCatalogs([]);
      fetchMock
        .mockReset()
        .mockResolvedValueOnce({ json: async () => ({ data: [] }), ok: true })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(params.models({ client: instance['client'] })).rejects.toThrow(
        'OpenRouter image models API request failed with status 500',
      );
    });

    it('propagates image catalog network and JSON failures', async () => {
      const fetchMock = mockCatalogs([]);
      fetchMock
        .mockReset()
        .mockResolvedValueOnce({ json: async () => ({ data: [] }), ok: true })
        .mockRejectedValueOnce(new Error('Image catalog network error'));

      await expect(params.models({ client: instance['client'] })).rejects.toThrow(
        'Image catalog network error',
      );

      fetchMock
        .mockReset()
        .mockResolvedValueOnce({ json: async () => ({ data: [] }), ok: true })
        .mockResolvedValueOnce({
          json: async () => {
            throw new Error('Invalid image JSON');
          },
          ok: true,
        });

      await expect(params.models({ client: instance['client'] })).rejects.toThrow(
        'Invalid image JSON',
      );
    });
  });

  describe('models', () => {
    beforeEach(() => {
      vi.clearAllMocks();
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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

      const releasedModel = models.find((m) => m.id === 'released/model');
      expect(releasedModel?.releasedAt).toBe('2023-03-23');
    });

    it('should handle empty model list from API', async () => {
      vi.stubGlobal(
        'fetch',
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: [] }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

      expect(models).toEqual([]);
    });

    it('should throw when fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        mockChatCatalogResponse({
          ok: false,
          status: 401,
        }),
      );

      await expect(params.models({ client: instance['client'] })).rejects.toThrow(
        'OpenRouter models API request failed with status 401',
      );
    });

    it('should throw when fetch throws error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      await expect(params.models({ client: instance['client'] })).rejects.toThrow('Network error');
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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

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
        mockChatCatalogResponse({
          ok: true,
          json: async () => ({ data: mockModels }),
        }),
      );

      const models = await params.models({ client: instance['client'] });

      const microPriceModel = models.find((m) => m.id === 'micro-price/model');
      expect(microPriceModel?.pricing?.units).toBeDefined();
      expect(microPriceModel?.pricing?.units?.length).toBe(2);
    });
  });
});
