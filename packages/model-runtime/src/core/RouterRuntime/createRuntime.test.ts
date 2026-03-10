import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

describe('createRouterRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('initialization', () => {
    it('should throw error when routers array is empty', async () => {
      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [],
      });
      const runtime = new Runtime();

      // 现在错误在使用时才抛出，因为是延迟创建
      await expect(
        runtime.chat({ model: 'test-model', messages: [], temperature: 0.7 }),
      ).rejects.toThrow('empty providers');
    });

    it('should create UniformRuntime class with valid routers', () => {
      class MockRuntime implements LobeRuntimeAI {
        chat = vi.fn();
        models = vi.fn();
        embeddings = vi.fn();
        textToSpeech = vi.fn();
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: { apiKey: 'test-key' },
            runtime: MockRuntime as any,
            models: ['gpt-4', 'gpt-3.5-turbo'],
          },
        ],
      });

      const runtime = new Runtime();
      expect(runtime).toBeDefined();
    });

    it('should merge router options with constructor options', async () => {
      const mockConstructor = vi.fn();

      class MockRuntime implements LobeRuntimeAI {
        constructor(options: any) {
          mockConstructor(options);
        }
        chat = vi.fn();
        models = vi.fn();
        embeddings = vi.fn();
        textToSpeech = vi.fn();
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: { baseURL: 'https://api.example.com' },
            runtime: MockRuntime as any,
            models: ['test-model'],
          },
        ],
      });

      const runtime = new Runtime({ apiKey: 'constructor-key' });

      // 触发 runtime 创建
      await runtime.chat({ model: 'test-model', messages: [], temperature: 0.7 });

      expect(mockConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.example.com',
          apiKey: 'constructor-key',
          id: 'test-runtime',
        }),
      );
    });
  });

  describe('chat method', () => {
    it('should call chat on the correct runtime based on model', async () => {
      const mockChat = vi.fn().mockResolvedValue('chat-response');

      class MockRuntime implements LobeRuntimeAI {
        chat = mockChat;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime();
      const payload = { model: 'gpt-4', messages: [], temperature: 0.7 };

      const result = await runtime.chat(payload);
      expect(result).toBe('chat-response');
      expect(mockChat).toHaveBeenCalledWith(payload, undefined);
    });

    it('should handle errors when provided with handleError', async () => {
      const mockError = new Error('API Error');
      const mockChat = vi.fn().mockRejectedValue(mockError);

      class MockRuntime implements LobeRuntimeAI {
        chat = mockChat;
      }

      const handleError = vi.fn().mockReturnValue({
        errorType: 'APIError',
        message: 'Handled error',
      });

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        chatCompletion: {
          handleError,
        },
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime();

      await expect(
        runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 }),
      ).rejects.toEqual({
        errorType: 'APIError',
        message: 'Handled error',
      });
    });

    it('should re-throw original error when handleError returns undefined', async () => {
      const mockError = new Error('API Error');
      const mockChat = vi.fn().mockRejectedValue(mockError);

      class MockRuntime implements LobeRuntimeAI {
        chat = mockChat;
      }

      const handleError = vi.fn().mockReturnValue(undefined);

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime({
        chat: {
          handleError,
        },
      });

      await expect(runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 })).rejects.toBe(
        mockError,
      );
    });
  });

  describe('models method', () => {
    it('should call models method on first runtime', async () => {
      const mockModels = vi.fn().mockResolvedValue(['model-1', 'model-2']);

      class MockRuntime implements LobeRuntimeAI {
        models = mockModels;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
          },
        ],
      });

      const runtime = new Runtime();
      const result = await runtime.models();

      expect(result).toEqual(['model-1', 'model-2']);
      expect(mockModels).toHaveBeenCalled();
    });
  });

  describe('embeddings method', () => {
    it('should call embeddings on the correct runtime based on model', async () => {
      const mockEmbeddings = vi.fn().mockResolvedValue('embeddings-response');

      class MockRuntime implements LobeRuntimeAI {
        embeddings = mockEmbeddings;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['text-embedding-ada-002'],
          },
        ],
      });

      const runtime = new Runtime();
      const payload = { model: 'text-embedding-ada-002', input: 'test input' };
      const options = {} as any;

      const result = await runtime.embeddings(payload, options);
      expect(result).toBe('embeddings-response');
      expect(mockEmbeddings).toHaveBeenCalledWith(payload, options);
    });
  });

  describe('textToSpeech method', () => {
    it('should call textToSpeech on the correct runtime based on model', async () => {
      const mockTextToSpeech = vi.fn().mockResolvedValue('speech-response');

      class MockRuntime implements LobeRuntimeAI {
        textToSpeech = mockTextToSpeech;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['tts-1'],
          },
        ],
      });

      const runtime = new Runtime();
      const payload = { model: 'tts-1', input: 'Hello world', voice: 'alloy' };
      const options = {} as any;

      const result = await runtime.textToSpeech(payload, options);
      expect(result).toBe('speech-response');
      expect(mockTextToSpeech).toHaveBeenCalledWith(payload, options);
    });
  });

  describe('dynamic routers configuration', () => {
    it('should support function-based routers configuration', async () => {
      class MockRuntime implements LobeRuntimeAI {
        chat = vi.fn().mockResolvedValue('chat-response');
        models = vi.fn();
        embeddings = vi.fn();
        textToSpeech = vi.fn();
      }

      const dynamicRoutersFunction = vi.fn((options: any) => [
        {
          apiType: 'openai' as const,
          options: {
            baseURL: `${options.baseURL || 'https://api.openai.com'}/v1`,
          },
          runtime: MockRuntime as any,
          models: ['gpt-4'],
        },
        {
          apiType: 'anthropic' as const,
          options: {
            baseURL: `${options.baseURL || 'https://api.anthropic.com'}/v1`,
          },
          runtime: MockRuntime as any,
          models: ['claude-3'],
        },
      ]);

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: dynamicRoutersFunction,
      });

      const userOptions = {
        apiKey: 'test-key',
        baseURL: 'https://yourapi.cn',
      };

      const runtime = new Runtime(userOptions);

      expect(runtime).toBeDefined();

      // 测试动态 routers 是否能正确工作
      const result = await runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 });
      expect(result).toBeDefined();

      // 验证动态函数被调用时传入了正确的参数
      expect(dynamicRoutersFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-key',
          baseURL: 'https://yourapi.cn',
        }),
        { model: 'gpt-4' },
      );
    });

    it('should throw error when dynamic routers function returns empty array', async () => {
      const emptyRoutersFunction = () => [];

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: emptyRoutersFunction,
      });
      const runtime = new Runtime();

      // 现在错误在使用时才抛出，因为是延迟创建
      await expect(
        runtime.chat({ model: 'test-model', messages: [], temperature: 0.7 }),
      ).rejects.toThrow('empty providers');
    });

    it('should support async function-based routers configuration', async () => {
      const mockChat = vi.fn().mockResolvedValue('async-chat-response');

      class MockRuntime implements LobeRuntimeAI {
        chat = mockChat;
      }

      const asyncRoutersFunction = vi.fn(async () => [
        {
          apiType: 'openai' as const,
          options: { apiKey: 'async-key' },
          runtime: MockRuntime as any,
          models: ['gpt-4'],
        },
      ]);

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: asyncRoutersFunction,
      });

      const runtime = new Runtime();
      const result = await runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 });

      expect(result).toBe('async-chat-response');
      expect(asyncRoutersFunction).toHaveBeenCalled();
    });
  });

  describe('fallback mechanism', () => {
    it('should fallback to next option when first option fails', async () => {
      // Test that errors are caught and re-thrown when all options fail
      const mockChatAlwaysFail = vi.fn().mockRejectedValue(new Error('All failed'));

      class AlwaysFailRuntime implements LobeRuntimeAI {
        chat = mockChatAlwaysFail;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: [{ apiKey: 'key-1' }, { apiKey: 'key-2' }],
            runtime: AlwaysFailRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime();
      await expect(
        runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 }),
      ).rejects.toThrow('All failed');

      // Verify chat was called twice (once per option)
      expect(mockChatAlwaysFail).toHaveBeenCalledTimes(2);
    });

    it('should throw error when options array is empty', async () => {
      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: [] as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime();
      await expect(
        runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 }),
      ).rejects.toThrow('empty provider options');
    });

    it('should use apiType from option item when specified for fallback', async () => {
      const constructorCalls: any[] = [];

      class MockRuntime implements LobeRuntimeAI {
        constructor(options: any) {
          constructorCalls.push(options);
        }
        chat = vi.fn().mockResolvedValue('response');
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: [{ apiKey: 'openai-key' }, { apiKey: 'anthropic-key', apiType: 'anthropic' }],
            runtime: MockRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime();
      await runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 });

      // First option should be tried
      expect(constructorCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('router matching', () => {
    describe('baseURLPattern matching', () => {
      it('should match router by baseURLPattern (RegExp)', async () => {
        const mockChatOpenAI = vi.fn().mockResolvedValue('openai-response');
        const mockChatAnthropic = vi.fn().mockResolvedValue('anthropic-response');

        class OpenAIRuntime implements LobeRuntimeAI {
          chat = mockChatOpenAI;
        }

        class AnthropicRuntime implements LobeRuntimeAI {
          chat = mockChatAnthropic;
        }

        const Runtime = createRouterRuntime({
          id: 'test-runtime',
          routers: [
            {
              apiType: 'anthropic',
              baseURLPattern: /\/anthropic\/?$/,
              options: { apiKey: 'anthropic-key' },
              runtime: AnthropicRuntime as any,
            },
            {
              apiType: 'openai',
              options: { apiKey: 'openai-key' },
              runtime: OpenAIRuntime as any,
            },
          ],
        });

        const runtime = new Runtime({
          apiKey: 'test',
          baseURL: 'https://api.example.com/anthropic',
        });
        const result = await runtime.chat({
          model: 'test-model',
          messages: [],
          temperature: 0.7,
        });

        expect(result).toBe('anthropic-response');
        expect(mockChatAnthropic).toHaveBeenCalled();
        expect(mockChatOpenAI).not.toHaveBeenCalled();
      });

      it('should prioritize baseURLPattern over models matching', async () => {
        const mockChatOpenAI = vi.fn().mockResolvedValue('openai-response');
        const mockChatAnthropic = vi.fn().mockResolvedValue('anthropic-response');

        class OpenAIRuntime implements LobeRuntimeAI {
          chat = mockChatOpenAI;
        }

        class AnthropicRuntime implements LobeRuntimeAI {
          chat = mockChatAnthropic;
        }

        const Runtime = createRouterRuntime({
          id: 'test-runtime',
          routers: [
            {
              apiType: 'anthropic',
              baseURLPattern: /\/anthropic\/?$/,
              options: { apiKey: 'anthropic-key' },
              runtime: AnthropicRuntime as any,
              models: ['claude-3'],
            },
            {
              apiType: 'openai',
              options: { apiKey: 'openai-key' },
              runtime: OpenAIRuntime as any,
              models: ['gpt-4', 'test-model'], // includes test-model
            },
          ],
        });

        // Even though 'test-model' matches OpenAI router, baseURLPattern should win
        const runtime = new Runtime({
          apiKey: 'test',
          baseURL: 'https://api.example.com/anthropic',
        });
        const result = await runtime.chat({
          model: 'test-model',
          messages: [],
          temperature: 0.7,
        });

        expect(result).toBe('anthropic-response');
      });
    });

    it('should fallback to last router when model does not match any', async () => {
      const mockChatFirst = vi.fn().mockResolvedValue('first-response');
      const mockChatLast = vi.fn().mockResolvedValue('last-response');

      class FirstRuntime implements LobeRuntimeAI {
        chat = mockChatFirst;
      }

      class LastRuntime implements LobeRuntimeAI {
        chat = mockChatLast;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: { apiKey: 'first-key' },
            runtime: FirstRuntime as any,
            models: ['gpt-4'],
          },
          {
            apiType: 'anthropic',
            options: { apiKey: 'last-key' },
            runtime: LastRuntime as any,
            models: ['claude-3'],
          },
        ],
      });

      const runtime = new Runtime();
      // Use a model that doesn't match any router
      const result = await runtime.chat({
        model: 'unknown-model',
        messages: [],
        temperature: 0.7,
      });

      expect(result).toBe('last-response');
      expect(mockChatLast).toHaveBeenCalled();
      expect(mockChatFirst).not.toHaveBeenCalled();
    });

    it('should match router with empty models array as fallback', async () => {
      const mockChatSpecific = vi.fn().mockResolvedValue('specific-response');
      const mockChatFallback = vi.fn().mockResolvedValue('fallback-response');

      class SpecificRuntime implements LobeRuntimeAI {
        chat = mockChatSpecific;
      }

      class FallbackRuntime implements LobeRuntimeAI {
        chat = mockChatFallback;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: { apiKey: 'specific-key' },
            runtime: SpecificRuntime as any,
            models: ['gpt-4'],
          },
          {
            apiType: 'openai',
            options: { apiKey: 'fallback-key' },
            runtime: FallbackRuntime as any,
            models: [], // Empty models array acts as catch-all
          },
        ],
      });

      const runtime = new Runtime();
      const result = await runtime.chat({
        model: 'any-model',
        messages: [],
        temperature: 0.7,
      });

      expect(result).toBe('fallback-response');
    });
  });

  describe('createImage method', () => {
    it('should call createImage on the correct runtime', async () => {
      const mockCreateImage = vi
        .fn()
        .mockResolvedValue({ imageUrl: 'https://example.com/image.png' });

      class MockRuntime implements LobeRuntimeAI {
        createImage = mockCreateImage;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['gpt-image-1'],
          },
        ],
      });

      const runtime = new Runtime();
      const payload = { model: 'gpt-image-1', params: { prompt: 'a cat' } };

      const result = await runtime.createImage(payload);
      expect(result).toEqual({ imageUrl: 'https://example.com/image.png' });
      expect(mockCreateImage).toHaveBeenCalledWith(payload);
    });
  });

  describe('generateObject method', () => {
    it('should call generateObject on the correct runtime', async () => {
      const mockGenerateObject = vi.fn().mockResolvedValue({ name: 'test' });

      class MockRuntime implements LobeRuntimeAI {
        generateObject = mockGenerateObject;
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime();
      const payload = { model: 'gpt-4', messages: [{ role: 'user' as const, content: 'test' }] };
      const options = { user: 'test-user' };

      const result = await runtime.generateObject(payload, options);
      expect(result).toEqual({ name: 'test' });
      expect(mockGenerateObject).toHaveBeenCalledWith(payload, options);
    });
  });

  describe('constructor options handling', () => {
    it('should trim apiKey and baseURL', async () => {
      const constructorOptions: any[] = [];

      class MockRuntime implements LobeRuntimeAI {
        constructor(options: any) {
          constructorOptions.push(options);
        }
        chat = vi.fn().mockResolvedValue('response');
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime({
        apiKey: '  trimmed-key  ',
        baseURL: '  https://api.example.com  ',
      });

      await runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 });

      expect(constructorOptions[0].apiKey).toBe('trimmed-key');
      expect(constructorOptions[0].baseURL).toBe('https://api.example.com');
    });

    it('should use default apiKey when not provided', async () => {
      const constructorOptions: any[] = [];

      class MockRuntime implements LobeRuntimeAI {
        constructor(options: any) {
          constructorOptions.push(options);
        }
        chat = vi.fn().mockResolvedValue('response');
      }

      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        apiKey: 'default-api-key',
        routers: [
          {
            apiType: 'openai',
            options: {},
            runtime: MockRuntime as any,
            models: ['gpt-4'],
          },
        ],
      });

      const runtime = new Runtime();
      await runtime.chat({ model: 'gpt-4', messages: [], temperature: 0.7 });

      expect(constructorOptions[0].apiKey).toBe('default-api-key');
    });
  });
});
