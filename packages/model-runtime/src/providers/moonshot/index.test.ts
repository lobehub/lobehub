// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeMoonshotAI, params } from './index';

const provider = 'moonshot';
const defaultBaseURL = 'https://api.moonshot.cn/v1';

testProvider({
  Runtime: LobeMoonshotAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_MOONSHOT_CHAT_COMPLETION',
  chatModel: 'moonshot-v1-8k',
  test: {
    skipAPICall: true,
  },
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeMoonshotAI({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeMoonshotAI - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_MOONSHOT_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_MOONSHOT_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_MOONSHOT_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    describe('empty assistant messages', () => {
      it('should replace empty string assistant message with a space', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: '', role: 'assistant' },
            { content: 'Follow-up', role: 'user' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { content: 'Hello', role: 'user' },
              { content: ' ', role: 'assistant' },
              { content: 'Follow-up', role: 'user' },
            ],
          }),
          expect.anything(),
        );
      });

      it('should replace null content assistant message with a space', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: null as any, role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { content: 'Hello', role: 'user' },
              { content: ' ', role: 'assistant' },
            ],
          }),
          expect.anything(),
        );
      });

      it('should replace undefined content assistant message with a space', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: undefined as any, role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { content: 'Hello', role: 'user' },
              { content: ' ', role: 'assistant' },
            ],
          }),
          expect.anything(),
        );
      });

      it('should not modify non-empty assistant messages', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: 'I am here', role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { content: 'Hello', role: 'user' },
              { content: 'I am here', role: 'assistant' },
            ],
          }),
          expect.anything(),
        );
      });

      it('should not modify user or system messages', async () => {
        await instance.chat({
          messages: [
            { content: '', role: 'system' },
            { content: '', role: 'user' },
            { content: '', role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { content: '', role: 'system' },
              { content: '', role: 'user' },
              { content: ' ', role: 'assistant' },
            ],
          }),
          expect.anything(),
        );
      });
    });

    describe('web search functionality', () => {
      it('should add $web_search tool when enabledSearch is true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: true,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [
              {
                function: {
                  name: '$web_search',
                },
                type: 'builtin_function',
              },
            ],
          }),
          expect.anything(),
        );
      });

      it('should add $web_search tool along with existing tools when enabledSearch is true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: true,
          tools: [
            {
              type: 'function',
              function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
            },
          ],
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [
              {
                type: 'function',
                function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
              },
              {
                function: {
                  name: '$web_search',
                },
                type: 'builtin_function',
              },
            ],
          }),
          expect.anything(),
        );
      });

      it('should not add $web_search tool when enabledSearch is false', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: false,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: undefined,
          }),
          expect.anything(),
        );
      });

      it('should not add $web_search tool when enabledSearch is not specified', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: undefined,
          }),
          expect.anything(),
        );
      });

      it('should preserve existing tools when enabledSearch is false', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: false,
          tools: [
            {
              type: 'function',
              function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
            },
          ],
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [
              {
                type: 'function',
                function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
              },
            ],
          }),
          expect.anything(),
        );
      });
    });

    describe('temperature normalization', () => {
      it('should normalize temperature (divide by 2)', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0.8,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.4,
          }),
          expect.anything(),
        );
      });

      it('should normalize temperature to 0.5 when temperature is 1', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 1,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.5,
          }),
          expect.anything(),
        );
      });

      it('should normalize temperature to 0 when temperature is 0', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0,
          }),
          expect.anything(),
        );
      });

      it('should handle high temperature values (2.0 normalized to 1.0)', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 2,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 1,
          }),
          expect.anything(),
        );
      });

      it('should normalize negative temperature values', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: -1,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: -0.5,
          }),
          expect.anything(),
        );
      });
    });

    describe('other payload properties', () => {
      it('should preserve other payload properties', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0.5,
          max_tokens: 100,
          top_p: 0.9,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'moonshot-v1-8k',
            temperature: 0.25,
            max_tokens: 100,
            top_p: 0.9,
          }),
          expect.anything(),
        );
      });

      it('should combine all features together', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: '', role: 'assistant' },
            { content: 'Question?', role: 'user' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0.7,
          max_tokens: 2000,
          enabledSearch: true,
          tools: [
            {
              type: 'function',
              function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
            },
          ],
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { content: 'Hello', role: 'user' },
              { content: ' ', role: 'assistant' },
              { content: 'Question?', role: 'user' },
            ],
            model: 'moonshot-v1-8k',
            temperature: 0.35,
            max_tokens: 2000,
            tools: [
              {
                type: 'function',
                function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
              },
              {
                function: {
                  name: '$web_search',
                },
                type: 'builtin_function',
              },
            ],
          }),
          expect.anything(),
        );
      });
    });
  });

  describe('models', () => {
    const mockClient = {
      models: {
        list: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models successfully', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'moonshot-v1-8k' }, { id: 'moonshot-v1-32k' }, { id: 'moonshot-v1-128k' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('moonshot-v1-8k');
      expect(models[1].id).toBe('moonshot-v1-32k');
      expect(models[2].id).toBe('moonshot-v1-128k');
    });

    it('should handle single model', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'moonshot-v1-8k' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('moonshot-v1-8k');
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should process models with MODEL_LIST_CONFIGS', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'moonshot-v1-8k' }],
      });

      const models = await params.models({ client: mockClient as any });

      // The processModelList function should merge with known model list
      expect(models[0]).toHaveProperty('id');
      expect(models[0].id).toBe('moonshot-v1-8k');
    });

    it('should preserve model properties from API response', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'moonshot-v1-8k', extra_field: 'value' },
          { id: 'moonshot-v1-32k', another_field: 123 },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('moonshot-v1-8k');
      expect(models[1].id).toBe('moonshot-v1-32k');
    });
  });
});
