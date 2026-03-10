// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeAi360AI, params } from './index';

testProvider({
  Runtime: LobeAi360AI,
  provider: ModelProvider.Ai360,
  defaultBaseURL: 'https://api.360.cn/v1',
  chatDebugEnv: 'DEBUG_AI360_CHAT_COMPLETION',
  chatModel: 'deepseek-r1',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeAi360AI - custom features', () => {
  let instance: InstanceType<typeof LobeAi360AI>;

  beforeEach(() => {
    instance = new LobeAi360AI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params.debug', () => {
    it('should disable debug mode by default', () => {
      delete process.env.DEBUG_AI360_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug mode when DEBUG_AI360_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_AI360_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_AI360_CHAT_COMPLETION;
    });

    it('should disable debug mode when DEBUG_AI360_CHAT_COMPLETION is not 1', () => {
      process.env.DEBUG_AI360_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_AI360_CHAT_COMPLETION;
    });
  });

  describe('params.chatCompletion.handlePayload', () => {
    it('should add web_search tool when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toBeDefined();
      expect(result.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
      expect(result.tools?.find((tool: any) => tool.type === 'web_search')).toEqual({
        type: 'web_search',
        web_search: {
          search_mode: 'auto',
        },
      });
    });

    it('should correctly set web_search properties', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);
      const webSearchTool = result.tools?.find((tool: any) => tool.type === 'web_search');

      expect(webSearchTool).toBeDefined();
      expect(webSearchTool.type).toBe('web_search');
      expect(webSearchTool.web_search).toBeDefined();
      expect(webSearchTool.web_search.search_mode).toBe('auto');
    });

    it('should not add web_search tool when enabledSearch is false', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: false,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toBeUndefined();
    });

    it('should not add web_search tool when enabledSearch is not present', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toBeUndefined();
    });

    it('should disable stream when tools are present', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools: [{ type: 'function', function: { name: 'test' } }],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.stream).toBe(false);
    });

    it('should disable stream when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.stream).toBe(false);
    });

    it('should not set stream to false when no tools', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.stream).not.toBe(false);
    });

    it('should merge tools with web_search when enabledSearch is true', () => {
      const existingTool = { type: 'function', function: { name: 'existing_tool' } };
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [existingTool],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toHaveLength(2);
      expect(result.tools).toContainEqual(existingTool);
      expect(result.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should remove enabledSearch from payload', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.enabledSearch).toBeUndefined();
    });

    it('should preserve other payload properties', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 0.9,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.messages).toEqual(payload.messages);
      expect(result.model).toBe(payload.model);
      expect(result.temperature).toBe(payload.temperature);
      expect(result.max_tokens).toBe(payload.max_tokens);
      expect(result.top_p).toBe(payload.top_p);
    });

    it('should handle empty tools array when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toHaveLength(1);
      expect(result.tools?.[0].type).toBe('web_search');
    });

    it('should handle multiple existing tools when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [
          { type: 'function', function: { name: 'tool1' } },
          { type: 'function', function: { name: 'tool2' } },
        ],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toHaveLength(3);
      expect(result.tools?.[0].function.name).toBe('tool1');
      expect(result.tools?.[1].function.name).toBe('tool2');
      expect(result.tools?.[2].type).toBe('web_search');
    });
  });

  describe('params.models', () => {
    it('should fetch and process models successfully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
              {
                id: '360gpt2-o1',
                max_tokens: 8192,
                total_tokens: 16384,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(mockClient.models.list).toHaveBeenCalled();
    });

    it('should correctly map model properties', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('360gpt-pro');
      expect(model.contextWindowTokens).toBe(8192);
      expect(model.maxOutput).toBe(4096);
    });

    it('should detect 360gpt-pro as function call capable', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.functionCall).toBe(true);
    });

    it('should detect reasoning models with 360gpt2-o1 keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt2-o1',
                max_tokens: 8192,
                total_tokens: 16384,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(true);
    });

    it('should detect reasoning models with 360zhinao2-o1 keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360zhinao2-o1-preview',
                max_tokens: 8192,
                total_tokens: 16384,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(true);
    });

    it('should handle case-insensitive reasoning keyword matching', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360GPT2-O1',
                max_tokens: 8192,
                total_tokens: 16384,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(true);
    });

    it('should merge with LOBE_DEFAULT_MODEL_LIST for known models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Known models from LOBE_DEFAULT_MODEL_LIST should have displayName and enabled flag
      expect(model.displayName).toBeDefined();
      expect(model.enabled).toBeDefined();
    });

    it('should handle models not in LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'unknown-model',
                max_tokens: 2048,
                total_tokens: 4096,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('unknown-model');
      expect(model.displayName).toBeUndefined();
      expect(model.enabled).toBe(false);
    });

    it('should inherit abilities from LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Check that abilities are inherited from known model
      expect(typeof model.functionCall).toBe('boolean');
      expect(typeof model.vision).toBe('boolean');
      expect(typeof model.reasoning).toBe('boolean');
    });

    it('should handle models with non-number max_tokens', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                max_tokens: 'unlimited' as any,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.maxOutput).toBeUndefined();
    });

    it('should handle models with null max_tokens', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                max_tokens: null as any,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.maxOutput).toBeUndefined();
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should handle model list with valid models only', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'model1',
                max_tokens: 4096,
                total_tokens: 8192,
              },
              {
                id: 'model2',
                max_tokens: 2048,
                total_tokens: 4096,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models.every((m) => m !== null && m.id)).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should set reasoning to false for non-reasoning models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-base',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(false);
    });

    it('should set functionCall to false for non-360gpt-pro models without functionCall ability', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.functionCall).toBe(false);
    });

    it('should set vision to false for models without vision ability', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.vision).toBe(false);
    });

    it('should handle case-insensitive model ID matching with LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360GPT-PRO',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should match case-insensitively with LOBE_DEFAULT_MODEL_LIST
      expect(model.id).toBe('360GPT-PRO');
      expect(model.displayName).toBeDefined();
    });

    it('should handle models with all properties present', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('contextWindowTokens');
      expect(model).toHaveProperty('maxOutput');
      expect(model).toHaveProperty('functionCall');
      expect(model).toHaveProperty('vision');
      expect(model).toHaveProperty('reasoning');
      expect(model).toHaveProperty('enabled');
    });

    it('should detect all reasoning model variants correctly', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt2-o1',
                max_tokens: 8192,
                total_tokens: 16384,
              },
              {
                id: '360gpt2-o1-preview',
                max_tokens: 8192,
                total_tokens: 16384,
              },
              {
                id: '360zhinao2-o1',
                max_tokens: 8192,
                total_tokens: 16384,
              },
              {
                id: '360zhinao2-o1-mini',
                max_tokens: 8192,
                total_tokens: 16384,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models).toHaveLength(4);
      expect(models.every((m) => m.reasoning === true)).toBe(true);
    });

    it('should handle models with zero context window', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                max_tokens: 0,
                total_tokens: 0,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.contextWindowTokens).toBe(0);
      expect(model.maxOutput).toBe(0);
    });

    it('should handle very large context window values', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'large-context-model',
                max_tokens: 128000,
                total_tokens: 1000000,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.contextWindowTokens).toBe(1000000);
      expect(model.maxOutput).toBe(128000);
    });

    it('should handle models with special characters in ID', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro-v2.0-beta',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('360gpt-pro-v2.0-beta');
    });

    it('should detect 360gpt-pro as functionCall capable', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('360gpt-pro');
      expect(model.functionCall).toBe(true);
    });

    it('should prioritize reasoning from keyword over knownModel', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt2-o1-custom',
                max_tokens: 8192,
                total_tokens: 16384,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should detect reasoning from keyword even if not in LOBE_DEFAULT_MODEL_LIST
      expect(model.reasoning).toBe(true);
    });

    it('should prioritize functionCall from model ID check over knownModel', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt-pro',
                max_tokens: 4096,
                total_tokens: 8192,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.functionCall).toBe(true);
    });

    it('should merge multiple capabilities correctly', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: '360gpt2-o1',
                max_tokens: 8192,
                total_tokens: 16384,
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(true);
      expect(typeof model.functionCall).toBe('boolean');
      expect(typeof model.vision).toBe('boolean');
    });
  });

  describe('LobeAi360AI instance - integration tests', () => {
    it('should add web_search tool when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toBeDefined();
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should disable stream when tools are present', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools: [{ type: 'function', function: { name: 'test' } }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(false);
    });

    it('should enable stream when no tools', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).not.toBe(false);
    });

    it('should merge tools with web_search when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [{ type: 'function', function: { name: 'existing_tool' } }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(2);
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'function')).toBe(true);
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should preserve temperature without normalization', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.7);
    });

    it('should preserve top_p without modification', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        top_p: 0.9,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.top_p).toBe(0.9);
    });

    it('should preserve max_tokens without modification', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        max_tokens: 1024,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.max_tokens).toBe(1024);
    });

    it('should preserve messages as-is', async () => {
      const messages = [
        { content: 'Hello', role: 'user' as const },
        { content: 'Hi there!', role: 'assistant' as const },
        { content: 'How are you?', role: 'user' as const },
      ];

      await instance.chat({
        messages,
        model: '360gpt-pro',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.messages).toEqual(messages);
    });

    it('should preserve model name', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt2-o1',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('360gpt2-o1');
    });

    it('should handle combined parameters correctly', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.8,
        top_p: 0.85,
        max_tokens: 2048,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('360gpt-pro');
      expect(calledPayload.temperature).toBe(0.8);
      expect(calledPayload.top_p).toBe(0.85);
      expect(calledPayload.max_tokens).toBe(2048);
    });

    it('should not include undefined parameters in payload', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('temperature');
      expect(callArgs).not.toHaveProperty('top_p');
      expect(callArgs).not.toHaveProperty('max_tokens');
    });
  });

  describe('exports', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Ai360);
      expect(params.baseURL).toBe('https://api.360.cn/v1');
    });

    it('should export LobeAi360AI class', () => {
      expect(LobeAi360AI).toBeDefined();
      expect(typeof LobeAi360AI).toBe('function');
    });

    it('should export params with all required properties', () => {
      expect(params).toHaveProperty('provider');
      expect(params).toHaveProperty('baseURL');
      expect(params).toHaveProperty('chatCompletion');
      expect(params).toHaveProperty('debug');
      expect(params).toHaveProperty('models');
    });

    it('should have chatCompletion.handlePayload function', () => {
      expect(params.chatCompletion).toBeDefined();
      expect(params.chatCompletion.handlePayload).toBeDefined();
      expect(typeof params.chatCompletion.handlePayload).toBe('function');
    });

    it('should have debug.chatCompletion function', () => {
      expect(params.debug).toBeDefined();
      expect(params.debug.chatCompletion).toBeDefined();
      expect(typeof params.debug.chatCompletion).toBe('function');
    });

    it('should have models function', () => {
      expect(params.models).toBeDefined();
      expect(typeof params.models).toBe('function');
    });
  });

  describe('edge cases and comprehensive coverage', () => {
    it('should handle payload with undefined tools', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools: undefined,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.tools).toBeUndefined();
    });

    it('should handle payload with null tools', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools: null as any,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.tools).toBeNull();
    });

    it('should handle empty messages array', async () => {
      await instance.chat({
        messages: [],
        model: '360gpt-pro',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.messages).toEqual([]);
    });

    it('should handle very small temperature values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.01,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.01);
    });

    it('should handle temperature of 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0);
    });

    it('should handle temperature of 1', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 1,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(1);
    });

    it('should handle high temperature values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 2,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(2);
    });

    it('should handle top_p of 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        top_p: 0,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.top_p).toBe(0);
    });

    it('should handle top_p of 1', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        top_p: 1,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.top_p).toBe(1);
    });

    it('should handle very small top_p values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        top_p: 0.01,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.top_p).toBe(0.01);
    });

    it('should handle large max_tokens values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        max_tokens: 100000,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.max_tokens).toBe(100000);
    });

    it('should handle complex message history with multiple roles', async () => {
      const messages = [
        { content: 'You are a helpful assistant', role: 'system' as const },
        { content: 'Hello', role: 'user' as const },
        { content: 'Hi! How can I help?', role: 'assistant' as const },
        { content: 'What is 2+2?', role: 'user' as const },
        { content: '2+2 equals 4', role: 'assistant' as const },
        { content: 'Thanks', role: 'user' as const },
      ];

      await instance.chat({
        messages,
        model: '360gpt-pro',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.messages).toEqual(messages);
    });

    it('should handle combined parameters with web search', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.8,
        top_p: 0.85,
        max_tokens: 2048,
        enabledSearch: true,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.8);
      expect(calledPayload.top_p).toBe(0.85);
      expect(calledPayload.max_tokens).toBe(2048);
      expect(calledPayload.stream).toBe(false);
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should handle combined parameters with tools and no web search', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.9,
        top_p: 0.95,
        max_tokens: 4096,
        tools: [{ type: 'function', function: { name: 'test_tool' } }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.9);
      expect(calledPayload.top_p).toBe(0.95);
      expect(calledPayload.max_tokens).toBe(4096);
      expect(calledPayload.stream).toBe(false);
      expect(calledPayload.tools).toHaveLength(1);
    });

    it('should preserve all model parameters', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360zhinao2-o1-preview',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('360zhinao2-o1-preview');
    });

    it('should handle multiple function tools', async () => {
      const tools = [
        { type: 'function' as const, function: { name: 'tool1', description: 'First tool' } },
        { type: 'function' as const, function: { name: 'tool2', description: 'Second tool' } },
        { type: 'function' as const, function: { name: 'tool3', description: 'Third tool' } },
      ];

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(3);
      expect(calledPayload.stream).toBe(false);
    });

    it('should handle enabledSearch with multiple function tools', async () => {
      const tools = [
        { type: 'function' as const, function: { name: 'tool1', description: 'First tool' } },
        { type: 'function' as const, function: { name: 'tool2', description: 'Second tool' } },
      ];

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(3);
      expect(calledPayload.tools?.filter((t: any) => t.type === 'function')).toHaveLength(2);
      expect(calledPayload.tools?.filter((t: any) => t.type === 'web_search')).toHaveLength(1);
      expect(calledPayload.stream).toBe(false);
    });
  });
});
