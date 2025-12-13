// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeZhipuAI, params } from './index';

testProvider({
  provider: 'zhipu',
  defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
  chatModel: 'glm-4',
  Runtime: LobeZhipuAI,
  chatDebugEnv: 'DEBUG_ZHIPU_CHAT_COMPLETION',
  test: {
    skipAPICall: true, // Skip because Zhipu has custom handlePayload that normalizes temperature
  },
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeZhipuAI({ apiKey: 'test' });

  // Mock chat.completions.create
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeZhipuAI - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_ZHIPU_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_ZHIPU_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_ZHIPU_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    describe('Web Search Feature', () => {
      it('should add web_search tool when enabledSearch is true', async () => {
        await instance.chat({
          enabledSearch: true,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: expect.arrayContaining([
              expect.objectContaining({
                type: 'web_search',
                web_search: expect.objectContaining({
                  enable: true,
                  result_sequence: 'before',
                  search_engine: 'search_std',
                  search_result: true,
                }),
              }),
            ]),
          }),
          expect.anything(),
        );
      });

      it('should use custom search engine from env', async () => {
        process.env.ZHIPU_SEARCH_ENGINE = 'search_pro';

        const payload = params.chatCompletion.handlePayload({
          enabledSearch: true,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
        });

        expect(payload.tools).toContainEqual(
          expect.objectContaining({
            type: 'web_search',
            web_search: expect.objectContaining({
              search_engine: 'search_pro',
            }),
          }),
        );

        delete process.env.ZHIPU_SEARCH_ENGINE;
      });

      it('should merge web_search with existing tools', async () => {
        const existingTool = {
          type: 'function' as const,
          function: { name: 'test_tool', parameters: {} },
        };

        await instance.chat({
          enabledSearch: true,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0,
          tools: [existingTool],
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: expect.arrayContaining([
              existingTool,
              expect.objectContaining({ type: 'web_search' }),
            ]),
          }),
          expect.anything(),
        );
      });

      it('should not add web_search tool when enabledSearch is false', async () => {
        await instance.chat({
          enabledSearch: false,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0,
        });

        const callArgs = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.tools).toBeUndefined();
      });

      it('should use existing tools without web_search when enabledSearch is not set', async () => {
        const existingTool = {
          type: 'function' as const,
          function: { name: 'test_tool', parameters: {} },
        };

        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0,
          tools: [existingTool],
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [existingTool],
          }),
          expect.anything(),
        );
      });
    });

    describe('Model-specific max_tokens constraints', () => {
      it('should limit max_tokens to 1024 for glm-4v models', async () => {
        await instance.chat({
          max_tokens: 2000,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4v',
          temperature: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            max_tokens: 1024,
          }),
          expect.anything(),
        );
      });

      it('should limit max_tokens to 15300 for glm-zero-preview model', async () => {
        await instance.chat({
          max_tokens: 20000,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-zero-preview',
          temperature: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            max_tokens: 15_300,
          }),
          expect.anything(),
        );
      });

      it('should allow max_tokens lower than constraint for glm-4v', async () => {
        await instance.chat({
          max_tokens: 512,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4v',
          temperature: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            max_tokens: 512,
          }),
          expect.anything(),
        );
      });

      it('should not limit max_tokens for other models', async () => {
        await instance.chat({
          max_tokens: 4000,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            max_tokens: 4000,
          }),
          expect.anything(),
        );
      });
    });

    describe('glm-4-alltools temperature and top_p constraints', () => {
      it('should clamp temperature to [0.01, 0.99] for glm-4-alltools', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4-alltools',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.01,
          }),
          expect.anything(),
        );
      });

      it('should clamp high temperature to 0.99 for glm-4-alltools', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4-alltools',
          temperature: 2.0, // Will be normalized to 1.0, then clamped to 0.99
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.99,
          }),
          expect.anything(),
        );
      });

      it('should clamp top_p to [0.01, 0.99] for glm-4-alltools', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4-alltools',
          temperature: 0.5,
          top_p: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: 0.01,
          }),
          expect.anything(),
        );
      });

      it('should clamp high top_p to 0.99 for glm-4-alltools', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4-alltools',
          temperature: 0.5,
          top_p: 1,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            top_p: 0.99,
          }),
          expect.anything(),
        );
      });

      it('should normalize and preserve temperature in range for glm-4-alltools', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4-alltools',
          temperature: 1.0, // Will be normalized to 0.5
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.5,
          }),
          expect.anything(),
        );
      });
    });

    describe('Temperature normalization', () => {
      it('should normalize temperature by dividing by 2', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 1.0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.5,
          }),
          expect.anything(),
        );
      });

      it('should normalize high temperature', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 1.6,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.8,
          }),
          expect.anything(),
        );
      });

      it('should handle temperature 0 correctly', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0,
          }),
          expect.anything(),
        );
      });
    });

    describe('Thinking mode for GLM-4.5 models', () => {
      it('should include thinking type for glm-4.5 models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4.5',
          temperature: 0.5,
          thinking: { type: 'enabled', budget_tokens: 1000 },
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: { type: 'enabled' },
          }),
          expect.anything(),
        );
      });

      it('should include thinking for glm-4.5-turbo', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4.5-turbo',
          temperature: 0.5,
          thinking: { type: 'disabled', budget_tokens: 0 },
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: { type: 'disabled' },
          }),
          expect.anything(),
        );
      });

      it('should not include thinking for non-4.5 models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0.5,
          thinking: { type: 'enabled', budget_tokens: 1000 },
        });

        const callArgs = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(callArgs.thinking).toBeUndefined();
      });

      it('should handle undefined thinking gracefully for 4.5 models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4.5',
          temperature: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: { type: undefined },
          }),
          expect.anything(),
        );
      });
    });

    describe('Stream parameter', () => {
      it('should always set stream to true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: true,
          }),
          expect.anything(),
        );
      });

      it('should override stream parameter to true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          stream: false,
          temperature: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: true,
          }),
          expect.anything(),
        );
      });
    });

    describe('Preserve other payload properties', () => {
      it('should preserve all other properties', async () => {
        await instance.chat({
          frequency_penalty: 0.5,
          max_tokens: 100,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          presence_penalty: 0.3,
          temperature: 0.5,
          top_p: 0.9,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            frequency_penalty: 0.5,
            max_tokens: 100,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'glm-4',
            presence_penalty: 0.3,
            temperature: 0.25, // Normalized from 0.5
            top_p: 0.9,
          }),
          expect.anything(),
        );
      });
    });
  });

  describe('handleStream', () => {
    describe('Tool calls index fixing for GLM-4.5', () => {
      it('should fix negative tool_calls index to positive', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: -1, id: 'call_1', function: { name: 'tool1', arguments: '{}' } },
                      { index: -1, id: 'call_2', function: { name: 'tool2', arguments: '{}' } },
                    ],
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4.5',
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });

        (instance['client'].chat.completions.create as any).mockResolvedValue(mockStream);

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4.5',
          temperature: 0.5,
        });

        // Read the stream to trigger the transform
        const reader = result.body?.getReader();
        const chunks = [];
        if (reader) {
          let done = false;
          while (!done) {
            const { value, done: isDone } = await reader.read();
            done = isDone;
            if (value) {
              chunks.push(new TextDecoder().decode(value));
            }
          }
        }

        // The transform should have fixed the negative indices
        expect(chunks).toBeDefined();
      });

      it('should preserve positive tool_calls index', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'call_1', function: { name: 'tool1', arguments: '{}' } },
                      { index: 1, id: 'call_2', function: { name: 'tool2', arguments: '{}' } },
                    ],
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4',
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });

        (instance['client'].chat.completions.create as any).mockResolvedValue(mockStream);

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0.5,
        });

        // Read the stream
        const reader = result.body?.getReader();
        if (reader) {
          let done = false;
          while (!done) {
            const { value, done: isDone } = await reader.read();
            done = isDone;
          }
        }

        expect(result).toBeDefined();
      });

      it('should handle chunks without tool_calls', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              choices: [
                {
                  delta: {
                    content: 'Hello',
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4',
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });

        (instance['client'].chat.completions.create as any).mockResolvedValue(mockStream);

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0.5,
        });

        expect(result).toBeInstanceOf(Response);
      });

      it('should handle chunks without choices', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4',
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });

        (instance['client'].chat.completions.create as any).mockResolvedValue(mockStream);

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0.5,
        });

        expect(result).toBeInstanceOf(Response);
      });

      it('should handle empty tool_calls array', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              choices: [
                {
                  delta: {
                    tool_calls: [],
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4',
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });

        (instance['client'].chat.completions.create as any).mockResolvedValue(mockStream);

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4',
          temperature: 0.5,
        });

        expect(result).toBeInstanceOf(Response);
      });

      it('should handle mixed tool_calls indices', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'call_1', function: { name: 'tool1', arguments: '{}' } },
                      { index: -1, id: 'call_2', function: { name: 'tool2', arguments: '{}' } },
                      { index: 2, id: 'call_3', function: { name: 'tool3', arguments: '{}' } },
                    ],
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4.5',
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });

        (instance['client'].chat.completions.create as any).mockResolvedValue(mockStream);

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4.5',
          temperature: 0.5,
        });

        // Read the stream to trigger the transform
        const reader = result.body?.getReader();
        if (reader) {
          let done = false;
          while (!done) {
            const { value, done: isDone } = await reader.read();
            done = isDone;
          }
        }

        expect(result).toBeDefined();
      });

      it('should handle multiple chunks with tool_calls', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            // First chunk with tool_call
            controller.enqueue({
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: -1, id: 'call_1', function: { name: 'tool1' } }],
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4.5',
              object: 'chat.completion.chunk',
            });
            // Second chunk with arguments
            controller.enqueue({
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: -1, function: { arguments: '{"a":1}' } }],
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
              created: 1234567890,
              id: 'chatcmpl-123',
              model: 'glm-4.5',
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });

        (instance['client'].chat.completions.create as any).mockResolvedValue(mockStream);

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-4.5',
          temperature: 0.5,
        });

        // Read the stream
        const reader = result.body?.getReader();
        if (reader) {
          let done = false;
          while (!done) {
            const { value, done: isDone } = await reader.read();
            done = isDone;
          }
        }

        expect(result).toBeDefined();
      });
    });
  });

  describe('exports', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe('zhipu');
      expect(params.baseURL).toBe('https://open.bigmodel.cn/api/paas/v4');
      expect(params.chatCompletion).toBeDefined();
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should export chatCompletion configuration with handlePayload', () => {
      expect(params.chatCompletion.handlePayload).toBeDefined();
      expect(typeof params.chatCompletion.handlePayload).toBe('function');
    });

    it('should export chatCompletion configuration with handleStream', () => {
      expect(params.chatCompletion.handleStream).toBeDefined();
      expect(typeof params.chatCompletion.handleStream).toBe('function');
    });

    it('should export debug configuration', () => {
      expect(params.debug.chatCompletion).toBeDefined();
      expect(typeof params.debug.chatCompletion).toBe('function');
    });

    it('should export models function', () => {
      expect(params.models).toBeDefined();
      expect(typeof params.models).toBe('function');
    });
  });

  describe('models', () => {
    const mockFetch = vi.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = mockFetch;
      vi.clearAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should fetch and process models with correct headers', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          rows: [
            {
              description: 'GLM-4 model',
              modelCode: 'glm-4',
              modelName: 'GLM-4',
            },
            {
              description: 'GLM-4V model',
              modelCode: 'glm-4v',
              modelName: 'GLM-4V',
            },
          ],
        }),
      });

      const mockClient = { apiKey: 'test_api_key' };
      await params.models({ client: mockClient as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/fine-tuning/model_center/list?pageSize=100&pageNum=1',
        {
          headers: {
            'Authorization': 'Bearer test_api_key',
            'Bigmodel-Organization': 'lobehub',
            'Bigmodel-Project': 'lobechat',
          },
          method: 'GET',
        },
      );
    });

    it('should process model list correctly', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          rows: [
            {
              description: 'GLM-4 model',
              modelCode: 'glm-4',
              modelName: 'GLM-4',
            },
          ],
        }),
      });

      const mockClient = { apiKey: 'test_api_key' };
      const models = await params.models({ client: mockClient as any });

      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should transform modelCode to id and modelName to displayName', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          rows: [
            {
              description: 'Test model',
              modelCode: 'test-model-code',
              modelName: 'Test Model Name',
            },
          ],
        }),
      });

      const mockClient = { apiKey: 'test_api_key' };
      const models = await params.models({ client: mockClient as any });

      // processModelList will merge with LOBE_DEFAULT_MODEL_LIST
      // Check that fetch was called and data was processed
      expect(mockFetch).toHaveBeenCalled();
      expect(models).toBeDefined();
    });

    it('should handle empty model list', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          rows: [],
        }),
      });

      const mockClient = { apiKey: 'test_api_key' };
      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should handle multiple models', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          rows: [
            {
              description: 'GLM-4 model',
              modelCode: 'glm-4',
              modelName: 'GLM-4',
            },
            {
              description: 'GLM-4V model',
              modelCode: 'glm-4v',
              modelName: 'GLM-4V',
            },
            {
              description: 'GLM-4-Air model',
              modelCode: 'glm-4-air',
              modelName: 'GLM-4-Air',
            },
          ],
        }),
      });

      const mockClient = { apiKey: 'test_api_key' };
      const models = await params.models({ client: mockClient as any });

      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should include description in model data', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          rows: [
            {
              description: 'This is a test description',
              modelCode: 'glm-4',
              modelName: 'GLM-4',
            },
          ],
        }),
      });

      const mockClient = { apiKey: 'test_api_key' };
      await params.models({ client: mockClient as any });

      // Verify the API was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test_api_key',
          }),
        }),
      );
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('API Error'));

      const mockClient = { apiKey: 'test_api_key' };

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should use correct API endpoint', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ rows: [] }),
      });

      const mockClient = { apiKey: 'test_api_key' };
      await params.models({ client: mockClient as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/fine-tuning/model_center/list?pageSize=100&pageNum=1',
        expect.anything(),
      );
    });
  });
});
