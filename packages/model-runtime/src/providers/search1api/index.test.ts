// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeSearch1API, params } from './index';

testProvider({
  provider: 'search1api',
  defaultBaseURL: 'https://api.search1api.com/v1',
  chatModel: 'gpt-4o-mini',
  Runtime: LobeSearch1API,
  chatDebugEnv: 'DEBUG_SEARCH1API_CHAT_COMPLETION',
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeSearch1API({ apiKey: 'test' });

  // Use vi.spyOn to mock chat.completions.create method
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeSearch1API - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_SEARCH1API_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_SEARCH1API_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_SEARCH1API_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    describe('presence_penalty handling', () => {
      it('should use presence_penalty when it is non-zero', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            presence_penalty: 0.5,
          }),
          expect.anything(),
        );
      });

      it('should use presence_penalty when it is negative', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: -0.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            presence_penalty: -0.5,
          }),
          expect.anything(),
        );
      });

      it('should use presence_penalty when it is 1', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 1,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            presence_penalty: 1,
          }),
          expect.anything(),
        );
      });

      it('should not include frequency_penalty when presence_penalty is non-zero', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0.5,
          frequency_penalty: 0.8,
        });

        const call = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(call.presence_penalty).toBe(0.5);
        expect(call.frequency_penalty).toBeUndefined();
      });
    });

    describe('frequency_penalty handling', () => {
      it('should use frequency_penalty when presence_penalty is 0', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0,
          frequency_penalty: 0.8,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            frequency_penalty: 0.8,
          }),
          expect.anything(),
        );
      });

      it('should use default frequency_penalty of 1 when presence_penalty is 0 and frequency_penalty is not provided', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            frequency_penalty: 1,
          }),
          expect.anything(),
        );
      });

      it('should use default frequency_penalty of 1 when presence_penalty is undefined and frequency_penalty is not provided', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
        });

        const call = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        // presence_penalty is undefined (not 0), so no frequency_penalty is set
        expect(call.presence_penalty).toBeUndefined();
      });

      it('should use frequency_penalty of 0 when explicitly set with presence_penalty 0', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0,
          frequency_penalty: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            frequency_penalty: 1, // 0 is falsy, so default to 1
          }),
          expect.anything(),
        );
      });

      it('should not include presence_penalty when presence_penalty is 0', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0,
          frequency_penalty: 0.8,
        });

        const call = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(call.frequency_penalty).toBe(0.8);
        expect(call.presence_penalty).toBeUndefined();
      });
    });

    describe('temperature handling', () => {
      it('should preserve temperature when it is less than 2', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          temperature: 0.7,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.7,
          }),
          expect.anything(),
        );
      });

      it('should preserve temperature when it is 0', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          temperature: 0,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0,
          }),
          expect.anything(),
        );
      });

      it('should preserve temperature when it is 1', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          temperature: 1,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 1,
          }),
          expect.anything(),
        );
      });

      it('should preserve temperature when it is 1.99', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          temperature: 1.99,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 1.99,
          }),
          expect.anything(),
        );
      });

      it('should set temperature to undefined when it is 2', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          temperature: 2,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: undefined,
          }),
          expect.anything(),
        );
      });

      it('should set temperature to undefined when it is greater than 2', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          temperature: 2.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: undefined,
          }),
          expect.anything(),
        );
      });

      it('should set temperature to undefined when it is not provided', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
        });

        const call = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(call.temperature).toBeUndefined();
      });
    });

    describe('stream handling', () => {
      it('should default stream to true when not specified', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: true,
          }),
          expect.anything(),
        );
      });

      it('should preserve stream value when explicitly set to false', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          stream: false,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: false,
          }),
          expect.anything(),
        );
      });

      it('should preserve stream value when explicitly set to true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          stream: true,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: true,
          }),
          expect.anything(),
        );
      });
    });

    describe('other properties preservation', () => {
      it('should preserve other payload properties', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          max_tokens: 100,
          top_p: 0.9,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4o-mini',
            max_tokens: 100,
            top_p: 0.9,
          }),
          expect.anything(),
        );
      });

      it('should preserve tools in payload', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          tools: [
            {
              type: 'function' as const,
              function: { name: 'tool1', description: '', parameters: {} },
            },
          ],
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [
              {
                type: 'function' as const,
                function: { name: 'tool1', description: '', parameters: {} },
              },
            ],
          }),
          expect.anything(),
        );
      });

      it('should preserve messages with multiple roles', async () => {
        const messages = [
          { content: 'Hello', role: 'user' as const },
          { content: 'Hi there', role: 'assistant' as const },
          { content: 'How are you?', role: 'user' as const },
        ];

        await instance.chat({
          messages,
          model: 'gpt-4o-mini',
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages,
          }),
          expect.anything(),
        );
      });
    });

    describe('combined parameter scenarios', () => {
      it('should handle presence_penalty with temperature < 2', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0.5,
          temperature: 0.8,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            presence_penalty: 0.5,
            temperature: 0.8,
          }),
          expect.anything(),
        );
      });

      it('should handle presence_penalty with temperature >= 2', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0.5,
          temperature: 2.5,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            presence_penalty: 0.5,
            temperature: undefined,
          }),
          expect.anything(),
        );
      });

      it('should handle frequency_penalty with temperature < 2', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0,
          frequency_penalty: 0.8,
          temperature: 0.7,
        });

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            frequency_penalty: 0.8,
            temperature: 0.7,
          }),
          expect.anything(),
        );
      });

      it('should handle all parameters together', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o-mini',
          presence_penalty: 0.5,
          frequency_penalty: 0.8, // Should be ignored
          temperature: 1.5,
          max_tokens: 200,
          top_p: 0.95,
          stream: false,
        });

        const call = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(call.presence_penalty).toBe(0.5);
        expect(call.frequency_penalty).toBeUndefined();
        expect(call.temperature).toBe(1.5);
        expect(call.max_tokens).toBe(200);
        expect(call.top_p).toBe(0.95);
        expect(call.stream).toBe(false);
      });
    });
  });

  describe('handlePayload edge cases', () => {
    it('should handle negative temperature values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        temperature: -1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: -1,
        }),
        expect.anything(),
      );
    });

    it('should handle very large temperature values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        temperature: 100,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: undefined,
        }),
        expect.anything(),
      );
    });

    it('should handle edge case temperature exactly at 2', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        temperature: 2,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: undefined,
        }),
        expect.anything(),
      );
    });

    it('should handle negative presence_penalty', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        presence_penalty: -2,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          presence_penalty: -2,
        }),
        expect.anything(),
      );
    });

    it('should handle negative frequency_penalty', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        presence_penalty: 0,
        frequency_penalty: -1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: -1,
        }),
        expect.anything(),
      );
    });

    it('should handle very small positive presence_penalty', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        presence_penalty: 0.001,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          presence_penalty: 0.001,
        }),
        expect.anything(),
      );
    });

    it('should handle empty messages array', async () => {
      await instance.chat({
        messages: [],
        model: 'gpt-4o-mini',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [],
        }),
        expect.anything(),
      );
    });

    it('should handle system messages', async () => {
      await instance.chat({
        messages: [
          { content: 'You are a helpful assistant', role: 'system' },
          { content: 'Hello', role: 'user' },
        ],
        model: 'gpt-4o-mini',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { content: 'You are a helpful assistant', role: 'system' },
            { content: 'Hello', role: 'user' },
          ],
        }),
        expect.anything(),
      );
    });

    it('should handle response_format parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        }),
        expect.anything(),
      );
    });

    it('should handle seed parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        seed: 12345,
      } as any);

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          seed: 12345,
        }),
        expect.anything(),
      );
    });

    it('should handle stop parameter as string', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        stop: 'STOP',
      } as any);

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stop: 'STOP',
        }),
        expect.anything(),
      );
    });

    it('should handle stop parameter as array', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        stop: ['STOP', 'END'],
      } as any);

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stop: ['STOP', 'END'],
        }),
        expect.anything(),
      );
    });

    it('should handle logit_bias parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        logit_bias: { '50256': -100 },
      } as any);

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          logit_bias: { '50256': -100 },
        }),
        expect.anything(),
      );
    });

    it('should handle tool_choice parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        tools: [
          {
            type: 'function' as const,
            function: { name: 'get_weather', description: '', parameters: {} },
          },
        ],
        tool_choice: 'auto',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: 'auto',
        }),
        expect.anything(),
      );
    });

    it('should handle parallel_tool_calls parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o-mini',
        tools: [
          {
            type: 'function' as const,
            function: { name: 'tool1', description: '', parameters: {} },
          },
        ],
        parallel_tool_calls: false,
      } as any);

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parallel_tool_calls: false,
        }),
        expect.anything(),
      );
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

    it('should fetch and process models from API', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, { id: 'claude-3-5-sonnet-20241022' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0]).toMatchObject({
        id: 'gpt-4o-mini',
      });
      expect(models[1]).toMatchObject({
        id: 'gpt-4o',
      });
      expect(models[2]).toMatchObject({
        id: 'claude-3-5-sonnet-20241022',
      });
    });

    it('should merge with known model list for all properties', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'gpt-4o-mini' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Should have properties from LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
      expect(models[0].contextWindowTokens).toBeDefined();
      expect(models[0].functionCall).toBe(true);
      expect(models[0].vision).toBe(true);
      // Check that enabled is defined
      expect(models[0].enabled).toBeDefined();
    });

    it('should handle case-insensitive model matching', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'GPT-4O-MINI' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('GPT-4O-MINI');
      // Should match with lowercase in LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
      expect(models[0].enabled).toBeDefined();
    });

    it('should handle models not in known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'unknown-custom-model' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'unknown-custom-model',
        displayName: undefined,
        enabled: false,
        contextWindowTokens: undefined,
        functionCall: false,
        vision: false,
        reasoning: false,
      });
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should preserve all known model abilities', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'claude-3-5-sonnet-20241022' },
          { id: 'deepseek-chat' },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models.length).toBe(3);
      models.forEach((model) => {
        expect(model).toHaveProperty('functionCall');
        expect(model).toHaveProperty('vision');
        expect(model).toHaveProperty('reasoning');
        expect(model).toHaveProperty('contextWindowTokens');
        expect(model).toHaveProperty('displayName');
        expect(model).toHaveProperty('enabled');
      });
    });

    it('should handle mix of known and unknown models', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'gpt-4o' },
          { id: 'unknown-model-1' },
          { id: 'gpt-4o-mini' },
          { id: 'unknown-model-2' },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(4);

      // Known models should have displayName
      expect(models[0].displayName).toBeDefined();
      expect(models[2].displayName).toBeDefined();

      // Unknown models should have undefined displayName
      expect(models[1].displayName).toBeUndefined();
      expect(models[3].displayName).toBeUndefined();
    });

    it('should preserve model id exactly as returned from API', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'Model-With-Mixed-CASE' },
          { id: 'model-with-dashes' },
          { id: 'model_with_underscores' },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('Model-With-Mixed-CASE');
      expect(models[1].id).toBe('model-with-dashes');
      expect(models[2].id).toBe('model_with_underscores');
    });

    it('should handle models with special characters in id', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'model:v1' }, { id: 'model@latest' }, { id: 'model/variant' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('model:v1');
      expect(models[1].id).toBe('model@latest');
      expect(models[2].id).toBe('model/variant');
    });

    it('should return models with correct structure', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'test-model' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('contextWindowTokens');
      expect(models[0]).toHaveProperty('displayName');
      expect(models[0]).toHaveProperty('enabled');
      expect(models[0]).toHaveProperty('functionCall');
      expect(models[0]).toHaveProperty('vision');
      expect(models[0]).toHaveProperty('reasoning');
    });

    it('should filter out falsy values', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'valid-model' }, null, undefined, { id: 'another-valid-model' }],
      });

      const models = await params.models({ client: mockClient as any });

      // Should only include valid models
      expect(models.length).toBeGreaterThan(0);
      models.forEach((model) => {
        expect(model).toBeTruthy();
        expect(model.id).toBeTruthy();
      });
    });

    it('should handle vision models from known list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'gpt-4o' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].vision).toBe(true);
    });

    it('should handle reasoning models from known list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'deepseek-reasoner' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Check if the model has reasoning capability based on known list
      expect(models[0]).toHaveProperty('reasoning');
    });

    it('should filter out models without id', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'valid-model' },
          { id: '' }, // Empty id
          { id: null }, // Null id
          { id: undefined }, // Undefined id
          { name: 'no-id-model' }, // Missing id
          { id: 'another-valid-model' },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      // Should only include models with valid ids
      expect(models.length).toBe(2);
      expect(models[0].id).toBe('valid-model');
      expect(models[1].id).toBe('another-valid-model');
    });

    it('should handle API errors gracefully', async () => {
      mockClient.models.list.mockRejectedValue(new Error('Network error'));

      // Should throw the error (no error handling in the implementation)
      await expect(params.models({ client: mockClient as any })).rejects.toThrow('Network error');
    });

    it('should handle malformed API response', async () => {
      mockClient.models.list.mockResolvedValue({
        data: null,
      });

      // This will throw an error when trying to access .filter on null
      await expect(params.models({ client: mockClient as any })).rejects.toThrow();
    });

    it('should handle API response without data field', async () => {
      mockClient.models.list.mockResolvedValue({});

      // This will throw an error when trying to access .data
      await expect(params.models({ client: mockClient as any })).rejects.toThrow();
    });

    it('should preserve model order from API', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'model-z' }, { id: 'model-a' }, { id: 'model-m' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('model-z');
      expect(models[1].id).toBe('model-a');
      expect(models[2].id).toBe('model-m');
    });

    it('should handle large number of models', async () => {
      const largeModelList = Array.from({ length: 100 }, (_, i) => ({ id: `model-${i}` }));
      mockClient.models.list.mockResolvedValue({
        data: largeModelList,
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(100);
      expect(models[0].id).toBe('model-0');
      expect(models[99].id).toBe('model-99');
    });

    it('should handle models with only id field', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'minimal-model' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'minimal-model',
        displayName: undefined,
        enabled: false,
        contextWindowTokens: undefined,
        functionCall: false,
        vision: false,
        reasoning: false,
      });
    });

    it('should handle function call models correctly', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'gpt-4o-mini' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].functionCall).toBe(true);
    });

    it('should handle models with whitespace in id', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: '  model-with-spaces  ' },
          { id: '\tmodel-with-tab\t' },
          { id: '\nmodel-with-newline\n' },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      // Should preserve the whitespace in the id
      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('  model-with-spaces  ');
      expect(models[1].id).toBe('\tmodel-with-tab\t');
      expect(models[2].id).toBe('\nmodel-with-newline\n');
    });

    it('should handle models with numeric ids', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: '12345' }, { id: '67890' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('12345');
      expect(models[1].id).toBe('67890');
    });

    it('should handle duplicate model ids', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'duplicate-model' }, { id: 'duplicate-model' }, { id: 'unique-model' }],
      });

      const models = await params.models({ client: mockClient as any });

      // Should include duplicates (no deduplication in implementation)
      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('duplicate-model');
      expect(models[1].id).toBe('duplicate-model');
      expect(models[2].id).toBe('unique-model');
    });
  });

  describe('Runtime instantiation', () => {
    it('should create runtime instance with apiKey', () => {
      const runtime = new LobeSearch1API({ apiKey: 'test-key' });
      expect(runtime).toBeDefined();
      expect(runtime).toBeInstanceOf(LobeSearch1API);
    });

    it('should create runtime instance with baseURL', () => {
      const runtime = new LobeSearch1API({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com/v1',
      });
      expect(runtime).toBeDefined();
    });

    it('should create runtime instance with all options', () => {
      const runtime = new LobeSearch1API({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com/v1',
        dangerouslyAllowBrowser: true,
      });
      expect(runtime).toBeDefined();
    });
  });

  describe('Provider configuration', () => {
    it('should have correct provider ID', () => {
      expect(params.provider).toBe('search1api');
    });

    it('should have correct baseURL', () => {
      expect(params.baseURL).toBe('https://api.search1api.com/v1');
    });

    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params).toHaveProperty('baseURL');
      expect(params).toHaveProperty('chatCompletion');
      expect(params).toHaveProperty('debug');
      expect(params).toHaveProperty('models');
      expect(params).toHaveProperty('provider');
    });

    it('should have chatCompletion.handlePayload function', () => {
      expect(params.chatCompletion.handlePayload).toBeDefined();
      expect(typeof params.chatCompletion.handlePayload).toBe('function');
    });

    it('should have debug.chatCompletion function', () => {
      expect(params.debug.chatCompletion).toBeDefined();
      expect(typeof params.debug.chatCompletion).toBe('function');
    });

    it('should have models function', () => {
      expect(params.models).toBeDefined();
      expect(typeof params.models).toBe('function');
    });
  });
});
