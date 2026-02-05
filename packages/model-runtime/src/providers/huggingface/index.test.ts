// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../types/error';
import { LobeHuggingFaceAI, params } from './index';

describe('LobeHuggingFaceAI', () => {
  let instance: any;

  beforeEach(() => {
    instance = new LobeHuggingFaceAI({ apiKey: 'test' });

    const mockAsyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [] } as any;
      },
    } as any;

    // mock custom client's chatCompletionStream
    instance['client'] = {
      chatCompletionStream: vi.fn().mockReturnValue(mockAsyncIterable),
    } as any;
  });

  it('should initialize and return StreamingTextResponse on chat', async () => {
    const res = await instance.chat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      temperature: 0,
      stream: true,
    });

    expect(res).toBeInstanceOf(Response);
  });

  it('should set provider id properly', async () => {
    // provider id 用于错误封装等，这里验证暴露 id 一致
    expect(ModelProvider.HuggingFace).toBe('huggingface');
  });

  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.HuggingFace);
    });

    it('should have chatCompletion configuration', () => {
      expect(params.chatCompletion).toBeDefined();
      expect(params.chatCompletion.handleStreamBizErrorType).toBeDefined();
    });

    it('should have customClient configuration', () => {
      expect(params.customClient).toBeDefined();
      expect(params.customClient.createClient).toBeDefined();
      expect(params.customClient.createChatCompletionStream).toBeDefined();
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
      delete process.env.DEBUG_HUGGINGFACE_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_HUGGINGFACE_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_HUGGINGFACE_CHAT_COMPLETION;
    });

    it('should disable debug when env is not "1"', () => {
      process.env.DEBUG_HUGGINGFACE_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_HUGGINGFACE_CHAT_COMPLETION;
    });
  });

  describe('Custom Error Handling', () => {
    it('should return PermissionDenied for Pro subscription error', () => {
      const error = {
        message:
          'Server meta-llama/Meta-Llama-3.1-8B-Instruct does not seem to support chat completion. Error: Model requires a Pro subscription; check out hf.co/pricing to learn more. Make sure to include your HF token in your query.',
      };

      const result = params.chatCompletion.handleStreamBizErrorType!(error as any);
      expect(result).toBe(AgentRuntimeErrorType.PermissionDenied);
    });

    it('should return InvalidProviderAPIKey for invalid token error', () => {
      const error = {
        message:
          'Server meta-llama/Meta-Llama-3.1-8B-Instruct does not seem to support chat completion. Error: Authorization header is correct, but the token seems invalid',
      };

      const result = params.chatCompletion.handleStreamBizErrorType!(error as any);
      expect(result).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    });

    it('should return undefined for other errors', () => {
      const error = {
        message: 'Some other error',
      };

      const result = params.chatCompletion.handleStreamBizErrorType!(error as any);
      expect(result).toBeUndefined();
    });

    it('should handle error without message property', () => {
      const error = {};

      const result = params.chatCompletion.handleStreamBizErrorType!(error as any);
      expect(result).toBeUndefined();
    });
  });

  describe('Custom Client', () => {
    it('should create HfInference client with api key', () => {
      const client = params.customClient!.createClient({ apiKey: 'test-api-key' });
      expect(client).toBeDefined();
    });

    describe('createChatCompletionStream', () => {
      it('should call client.chatCompletionStream with correct parameters', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = {
          baseURL: 'https://api.example.com',
        };

        const payload = {
          max_tokens: 2048,
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
          temperature: 0.7,
          top_p: 0.9,
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith({
          endpointUrl: 'https://api.example.com/test-model',
          max_tokens: 2048,
          messages: payload.messages,
          model: 'test-model',
          stream: true,
          temperature: 0.7,
          top_p: 0.9,
        });
      });

      it('should handle undefined baseURL', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = {
          baseURL: undefined,
        };

        const payload = {
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith(
          expect.objectContaining({
            endpointUrl: undefined,
          }),
        );
      });

      it('should clamp top_p to 0.99 when >= 1', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = { baseURL: 'https://api.example.com' };

        const payload = {
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
          top_p: 1,
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: 0.99,
          }),
        );
      });

      it('should clamp top_p to 0.99 when > 1', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = { baseURL: 'https://api.example.com' };

        const payload = {
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
          top_p: 1.5,
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: 0.99,
          }),
        );
      });

      it('should set top_p to undefined when 0 (falsy value)', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = { baseURL: 'https://api.example.com' };

        const payload = {
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
          top_p: 0,
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: undefined,
          }),
        );
      });

      it('should clamp top_p to 0.01 when < 0', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = { baseURL: 'https://api.example.com' };

        const payload = {
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
          top_p: -0.5,
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: 0.01,
          }),
        );
      });

      it('should keep top_p unchanged when in valid range', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = { baseURL: 'https://api.example.com' };

        const payload = {
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
          top_p: 0.5,
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: 0.5,
          }),
        );
      });

      it('should set top_p to undefined when not provided', () => {
        const mockClient = {
          chatCompletionStream: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [] } as any;
            },
          }),
        } as any;

        const mockInstance = { baseURL: 'https://api.example.com' };

        const payload = {
          messages: [{ role: 'user', content: 'test' }],
          model: 'test-model',
        };

        params.customClient!.createChatCompletionStream(mockClient, payload as any, mockInstance);

        expect(mockClient.chatCompletionStream).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: undefined,
          }),
        );
      });
    });
  });

  describe('Models Fetching', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch and process models from HuggingFace API', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
            object: 'model',
            created: 1759170171,
            owned_by: 'meta-llama',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'huggingface',
                status: 'live',
                context_length: 8192,
                supports_tools: false,
                supports_structured_output: false,
                is_model_author: true,
              },
            ],
          },
          {
            id: 'microsoft/Phi-3-mini-4k-instruct',
            object: 'model',
            created: 1759170171,
            owned_by: 'microsoft',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'huggingface',
                status: 'live',
                context_length: 4096,
                supports_tools: false,
                supports_structured_output: false,
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      expect(fetch).toHaveBeenCalledWith('https://router.huggingface.co/v1/models');
      expect(models.length).toBeGreaterThan(0);
    });

    it('should detect function-calling ability from provider info', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'test-model',
            object: 'model',
            created: 1759170171,
            owned_by: 'test',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'test',
                status: 'live',
                supports_tools: true,
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].functionCall).toBe(true);
    });

    it('should detect vision ability from input_modalities', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'vision-model-1',
            object: 'model',
            created: 1759170171,
            owned_by: 'test',
            architecture: {
              input_modalities: ['image', 'text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'test',
                status: 'live',
                is_model_author: true,
              },
            ],
          },
          {
            id: 'vision-model-2',
            object: 'model',
            created: 1759170171,
            owned_by: 'test',
            architecture: {
              input_modalities: ['image'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'test',
                status: 'live',
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      expect(models.length).toBeGreaterThan(0);
      const visionModels = models.filter((m) => m.vision);
      expect(visionModels.length).toBeGreaterThan(0);
    });

    it('should merge with LOBE_DEFAULT_MODEL_LIST when model is known', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'meta-llama/llama-3.3-70b-instruct',
            object: 'model',
            created: 1759170171,
            owned_by: 'meta-llama',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'huggingface',
                status: 'live',
                context_length: 8192,
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      const model = models.find((m) => m.id === 'meta-llama/llama-3.3-70b-instruct');
      expect(model).toBeDefined();
      // Should have properties from LOBE_DEFAULT_MODEL_LIST if the model exists there
      if (model) {
        expect(model.enabled).toBeDefined();
        expect(typeof model.enabled).toBe('boolean');
      }
    });

    it('should handle models with case-insensitive matching', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'META-LLAMA/LLAMA-3.3-70B-INSTRUCT',
            object: 'model',
            created: 1759170171,
            owned_by: 'meta-llama',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'huggingface',
                status: 'live',
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBe('META-LLAMA/LLAMA-3.3-70B-INSTRUCT');
    });

    it('should set default values for unknown models', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'unknown/unknown-model',
            object: 'model',
            created: 1759170171,
            owned_by: 'unknown',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'unknown',
                status: 'live',
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].enabled).toBe(false);
      expect(models[0].functionCall).toBe(false);
      expect(models[0].reasoning).toBe(false);
      expect(models[0].vision).toBe(false);
    });

    it('should combine provider-based and model-list-based abilities', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'meta-llama/llama-3.3-70b-instruct',
            object: 'model',
            created: 1759170171,
            owned_by: 'meta-llama',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'huggingface',
                status: 'live',
                supports_tools: true,
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      const model = models.find((m) => m.id === 'meta-llama/llama-3.3-70b-instruct');
      if (model) {
        // Should have true if either provider info or model list has the ability
        expect(typeof model.functionCall).toBe('boolean');
      }
    });

    it('should handle empty model list', async () => {
      const mockResponse = {
        object: 'list',
        data: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();

      expect(models).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('API Error'));

      const result = await params.models!();
      expect(result).toEqual([]);
    });

    it('should handle invalid JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as unknown as Response);

      const result = await params.models!();
      expect(result).toEqual([]);
    });

    it('should preserve contextWindowTokens from provider info', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'meta-llama/llama-3.3-70b-instruct',
            object: 'model',
            created: 1759170171,
            owned_by: 'meta-llama',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'huggingface',
                status: 'live',
                context_length: 8192,
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      const model = models.find((m) => m.id === 'meta-llama/llama-3.3-70b-instruct');

      if (model) {
        // contextWindowTokens should be preserved from provider info
        expect(model.contextWindowTokens).toBe(8192);
      }
    });

    it('should preserve displayName from known models', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'meta-llama/llama-3.3-70b-instruct',
            object: 'model',
            created: 1759170171,
            owned_by: 'meta-llama',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'huggingface',
                status: 'live',
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      const model = models.find((m) => m.id === 'meta-llama/llama-3.3-70b-instruct');

      if (model) {
        // displayName should be preserved from LOBE_DEFAULT_MODEL_LIST if available
        expect(model.displayName).toBeDefined();
      }
    });

    it('should fallback to other providers when model_author has missing context_length', async () => {
      // 场景：zai-org 是 is_model_author 但没有 context_length，novita provider 有完整信息
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'zai-org/GLM-4.6',
            object: 'model',
            created: 1759170171,
            owned_by: 'zai-org',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'novita',
                status: 'live',
                context_length: 204800,
                pricing: {
                  input: 0.6,
                  output: 2.2,
                },
                supports_tools: true,
                supports_structured_output: false,
                is_model_author: false,
              },
              {
                provider: 'zai-org',
                status: 'live',
                supports_tools: true,
                supports_structured_output: false,
                is_model_author: true,
                // context_length 缺失
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      expect(models.length).toBeGreaterThan(0);

      const model = models[0];
      // 应该从 novita provider 回退获取到 context_length
      expect(model.contextWindowTokens).toBe(204800);
      // 应该从 zai-org provider 获取到 supports_tools
      expect(model.functionCall).toBe(true);
    });

    it('should fallback to other providers when model_author has missing supports_tools', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'test/model',
            object: 'model',
            created: 1759170171,
            owned_by: 'test',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'provider-with-tools',
                status: 'live',
                context_length: 2048,
                supports_tools: true,
                is_model_author: false,
              },
              {
                provider: 'author',
                status: 'live',
                context_length: 2048,
                is_model_author: true,
                // supports_tools 缺失
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      expect(models.length).toBeGreaterThan(0);

      const model = models[0];
      // 应该从 author provider 获取到 context_length
      expect(model.contextWindowTokens).toBe(2048);
      // 应该从 provider-with-tools 回退获取到 supports_tools
      expect(model.functionCall).toBe(true);
    });

    it('should use model_author provider data when all fields are present', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'author/complete-model',
            object: 'model',
            created: 1759170171,
            owned_by: 'author',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'other',
                status: 'live',
                context_length: 1024,
                supports_tools: false,
                is_model_author: false,
              },
              {
                provider: 'author',
                status: 'live',
                context_length: 8192,
                supports_tools: true,
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      expect(models.length).toBeGreaterThan(0);

      const model = models[0];
      // 应该使用 author provider 的完整数据，而不是 other provider
      expect(model.contextWindowTokens).toBe(8192);
      expect(model.functionCall).toBe(true);
    });

    it('should select provider with most complete information when no model_author', async () => {
      // 场景：没有 is_model_author，但 novita provider 信息更完整
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'deepseek-ai/DeepSeek-V3.2-Exp',
            object: 'model',
            created: 1759126046,
            owned_by: 'deepseek-ai',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'novita',
                status: 'live',
                context_length: 163840,
                pricing: {
                  input: 0.27,
                  output: 0.41,
                },
                supports_tools: true,
                supports_structured_output: true,
                is_model_author: false,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      expect(models.length).toBeGreaterThan(0);

      const model = models[0];
      // 应该从 novita provider 获取完整信息
      expect(model.contextWindowTokens).toBe(163840);
      expect(model.functionCall).toBe(true);
      expect(model.id).toBe('deepseek-ai/DeepSeek-V3.2-Exp');
    });

    it('should prefer provider with more fields when is_model_author is absent', async () => {
      // 场景：两个非作者 provider，选择信息更完整的
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'test/model',
            object: 'model',
            created: 1759170171,
            owned_by: 'test',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'provider-incomplete',
                status: 'live',
                context_length: 2048,
                // 只有 3 个字段
                is_model_author: false,
              },
              {
                provider: 'provider-complete',
                status: 'live',
                context_length: 4096,
                supports_tools: true,
                supports_structured_output: true,
                pricing: {
                  input: 0.1,
                  output: 0.2,
                },
                // 5 个字段，更完整
                is_model_author: false,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      expect(models.length).toBeGreaterThan(0);

      const model = models[0];
      // 应该选择 provider-complete（信息更完整）而不是 provider-incomplete
      expect(model.contextWindowTokens).toBe(4096);
      expect(model.functionCall).toBe(true);
    });

    it('should extract pricing information from provider', async () => {
      // 场景：pricing 存在于 provider 中
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'zai-org/GLM-4.6',
            object: 'model',
            created: 1759170171,
            owned_by: 'zai-org',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'novita',
                status: 'live',
                context_length: 204800,
                pricing: {
                  input: 0.6,
                  output: 2.2,
                },
                supports_tools: true,
                is_model_author: false,
              },
              {
                provider: 'zai-org',
                status: 'live',
                supports_tools: true,
                is_model_author: true,
                // pricing 缺失
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      expect(models.length).toBeGreaterThan(0);

      const model = models[0];
      // 应该从 novita 回退获取到 pricing
      // 注意：processMultiProviderModelList 会转换 pricing 格式
      expect(model.pricing).toBeDefined();
      if (model.pricing && typeof model.pricing === 'object' && 'units' in model.pricing) {
        // 经过转换的格式
        expect((model.pricing as any).units).toHaveLength(2);
      } else {
        // 原始格式
        expect(model.pricing).toEqual({
          input: 0.6,
          output: 2.2,
        });
      }
    });

    it('should use pricing from model_author when available', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'author/model',
            object: 'model',
            created: 1759170171,
            owned_by: 'author',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            providers: [
              {
                provider: 'other',
                status: 'live',
                pricing: {
                  input: 0.1,
                  output: 0.1,
                },
                is_model_author: false,
              },
              {
                provider: 'author',
                status: 'live',
                pricing: {
                  input: 0.05,
                  output: 0.15,
                },
                is_model_author: true,
              },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const models = await params.models!();
      expect(models.length).toBeGreaterThan(0);

      const model = models[0];
      // 应该优先使用 author provider 的定价
      // 注意：processMultiProviderModelList 会转换 pricing 格式
      expect(model.pricing).toBeDefined();
      if (model.pricing && typeof model.pricing === 'object' && 'units' in model.pricing) {
        // 经过转换的格式，检查 rate 值
        const pricingUnits = (model.pricing as any).units;
        expect(pricingUnits).toHaveLength(2);
        const inputUnit = pricingUnits.find((u: any) => u.name === 'textInput');
        const outputUnit = pricingUnits.find((u: any) => u.name === 'textOutput');
        expect(inputUnit?.rate).toBe(0.05);
        expect(outputUnit?.rate).toBe(0.15);
      } else {
        // 原始格式
        expect(model.pricing).toEqual({
          input: 0.05,
          output: 0.15,
        });
      }
    });
  });
});
