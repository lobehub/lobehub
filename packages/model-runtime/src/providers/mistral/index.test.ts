// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeMistralAI, params } from './index';

testProvider({
  provider: 'mistral',
  defaultBaseURL: 'https://api.mistral.ai/v1',
  chatModel: 'open-mistral-7b',
  Runtime: LobeMistralAI,
  chatDebugEnv: 'DEBUG_MISTRAL_CHAT_COMPLETION',
  test: {
    skipAPICall: true, // Mistral has custom payload handling (excludeUsage, temperature normalization)
  },
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeMistralAI({ apiKey: 'test' });

  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeMistralAI - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_MISTRAL_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_MISTRAL_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_MISTRAL_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should exclude stream_options (excludeUsage)', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 0.7,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ stream_options: expect.anything() }),
        expect.anything(),
      );
    });

    it('should normalize temperature (divide by 2)', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 0.8,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.4 }),
        expect.anything(),
      );
    });

    it('should normalize temperature to 0.5 when temperature is 1', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 }),
        expect.anything(),
      );
    });

    it('should normalize temperature to 0 when temperature is 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 0,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0 }),
        expect.anything(),
      );
    });

    it('should handle high temperature values (2.0 normalized to 1.0)', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 2,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 1 }),
        expect.anything(),
      );
    });

    it('should set stream to true by default', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true }),
        expect.anything(),
      );
    });

    it('should preserve top_p without modification', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        top_p: 0.9,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ top_p: 0.9 }),
        expect.anything(),
      );
    });

    it('should preserve max_tokens without modification', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        max_tokens: 1024,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 1024 }),
        expect.anything(),
      );
    });

    it('should include tools when provided', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: { name: 'test_tool', description: 'A test tool', parameters: {} },
        },
      ];

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        tools,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ tools }),
        expect.anything(),
      );
    });

    it('should not include tools when not provided', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('tools');
    });

    it('should preserve messages as-is', async () => {
      const messages = [
        { content: 'Hello', role: 'user' as const },
        { content: 'Hi there!', role: 'assistant' as const },
        { content: 'How are you?', role: 'user' as const },
      ];

      await instance.chat({
        messages,
        model: 'open-mistral-7b',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ messages }),
        expect.anything(),
      );
    });

    it('should preserve model name', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistral-large-latest',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'mistral-large-latest' }),
        expect.anything(),
      );
    });

    it('should handle combined parameters correctly', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistral-large-latest',
        temperature: 1.4,
        top_p: 0.85,
        max_tokens: 2048,
        tools: [
          {
            type: 'function' as const,
            function: { name: 'calculator', description: 'Calculate', parameters: {} },
          },
        ],
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'mistral-large-latest',
          temperature: 0.7, // 1.4 / 2
          top_p: 0.85,
          max_tokens: 2048,
          stream: true,
          tools: expect.any(Array),
        }),
        expect.anything(),
      );
    });

    it('should not include undefined parameters in payload', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
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
      expect(params.provider).toBe('mistral');
      expect(params.baseURL).toBe('https://api.mistral.ai/v1');
      expect(params.chatCompletion).toBeDefined();
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should export chatCompletion configuration', () => {
      expect(params.chatCompletion.excludeUsage).toBe(true);
      expect(params.chatCompletion.noUserId).toBe(true);
      expect(params.chatCompletion.handlePayload).toBeDefined();
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

    it('should fetch and process models with function calling capability', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'mistral-large-latest',
            max_context_length: 128000,
            capabilities: {
              function_calling: true,
              vision: false,
            },
            description: 'Mistral Large model',
          },
          {
            id: 'mistral-small-latest',
            max_context_length: 32000,
            capabilities: {
              function_calling: true,
              vision: false,
            },
            description: 'Mistral Small model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'mistral-large-latest',
        contextWindowTokens: 128000,
        functionCall: true,
        vision: false,
        description: 'Mistral Large model',
      });
      expect(models[1]).toMatchObject({
        id: 'mistral-small-latest',
        contextWindowTokens: 32000,
        functionCall: true,
        vision: false,
        description: 'Mistral Small model',
      });
    });

    it('should detect vision capability from model capabilities', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'pixtral-12b-latest',
            max_context_length: 128000,
            capabilities: {
              function_calling: true,
              vision: true,
            },
            description: 'Pixtral vision model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'pixtral-12b-latest',
        vision: true,
        functionCall: true,
      });
    });

    it('should merge with known model list for display name and enabled status', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'mistral-large-latest',
            max_context_length: 128000,
            capabilities: {
              function_calling: true,
              vision: false,
            },
            description: 'Latest Mistral Large',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Should have displayName and enabled from LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
    });

    it('should handle models not in known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'unknown-mistral-model',
            max_context_length: 8192,
            capabilities: {
              function_calling: false,
              vision: false,
            },
            description: 'Unknown model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'unknown-mistral-model',
        contextWindowTokens: 8192,
        functionCall: false,
        vision: false,
        displayName: undefined,
        enabled: false,
        description: 'Unknown model',
      });
    });

    it('should handle case-insensitive model matching', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'MISTRAL-LARGE-LATEST',
            max_context_length: 128000,
            capabilities: {
              function_calling: true,
              vision: false,
            },
            description: 'Large model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('MISTRAL-LARGE-LATEST');
      // Should match with lowercase in LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
    });

    it('should detect reasoning capability from known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'mistral-large-latest',
            max_context_length: 128000,
            capabilities: {
              function_calling: true,
              vision: false,
            },
            description: 'Latest large model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toHaveProperty('reasoning');
      // reasoning should be false unless specified in LOBE_DEFAULT_MODEL_LIST
      expect(models[0].reasoning).toBe(false);
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should combine multiple capabilities correctly', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'pixtral-large-latest',
            max_context_length: 128000,
            capabilities: {
              function_calling: true,
              vision: true,
            },
            description: 'Multimodal large model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'pixtral-large-latest',
        contextWindowTokens: 128000,
        functionCall: true,
        vision: true,
        description: 'Multimodal large model',
      });
    });

    it('should preserve context window tokens accurately', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'model-1',
            max_context_length: 4096,
            capabilities: { function_calling: false, vision: false },
            description: 'Small context',
          },
          {
            id: 'model-2',
            max_context_length: 32768,
            capabilities: { function_calling: true, vision: false },
            description: 'Medium context',
          },
          {
            id: 'model-3',
            max_context_length: 200000,
            capabilities: { function_calling: true, vision: true },
            description: 'Large context',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0].contextWindowTokens).toBe(4096);
      expect(models[1].contextWindowTokens).toBe(32768);
      expect(models[2].contextWindowTokens).toBe(200000);
    });

    it('should handle mixed capability models', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'text-only-model',
            max_context_length: 8192,
            capabilities: {
              function_calling: true,
              vision: false,
            },
            description: 'Text only',
          },
          {
            id: 'vision-model',
            max_context_length: 16384,
            capabilities: {
              function_calling: false,
              vision: true,
            },
            description: 'Vision only',
          },
          {
            id: 'basic-model',
            max_context_length: 4096,
            capabilities: {
              function_calling: false,
              vision: false,
            },
            description: 'Basic model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0].functionCall).toBe(true);
      expect(models[0].vision).toBe(false);
      expect(models[1].functionCall).toBe(false);
      expect(models[1].vision).toBe(true);
      expect(models[2].functionCall).toBe(false);
      expect(models[2].vision).toBe(false);
    });

    it('should handle all properties from API response', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'complete-model',
            max_context_length: 100000,
            capabilities: {
              function_calling: true,
              vision: true,
            },
            description: 'A complete test model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      const model = models[0];
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('contextWindowTokens');
      expect(model).toHaveProperty('functionCall');
      expect(model).toHaveProperty('vision');
      expect(model).toHaveProperty('description');
      expect(model).toHaveProperty('displayName');
      expect(model).toHaveProperty('enabled');
      expect(model).toHaveProperty('reasoning');
    });

    it('should handle API errors gracefully', async () => {
      mockClient.models.list.mockRejectedValue(new Error('Network error'));

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('Network error');
    });

    it('should handle null or undefined data gracefully', async () => {
      mockClient.models.list.mockResolvedValue({
        data: null as any,
      });

      await expect(params.models({ client: mockClient as any })).rejects.toThrow();
    });

    it('should handle model with missing capabilities', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'incomplete-model',
            max_context_length: 8192,
            capabilities: {} as any,
            description: 'Model with missing capabilities',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].functionCall).toBeUndefined();
      expect(models[0].vision).toBeUndefined();
    });

    it('should handle model with null capabilities', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'null-caps-model',
            max_context_length: 8192,
            capabilities: null as any,
            description: 'Model with null capabilities',
          },
        ],
      });

      await expect(params.models({ client: mockClient as any })).rejects.toThrow();
    });

    it('should filter out falsy values', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'valid-model',
            max_context_length: 8192,
            capabilities: {
              function_calling: false,
              vision: false,
            },
            description: 'Valid model',
          },
          null,
          undefined,
        ].filter(Boolean),
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('valid-model');
    });
  });

  describe('handlePayload - edge cases', () => {
    it('should handle payload with frequency_penalty', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        frequency_penalty: 0.5,
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      // frequency_penalty is not part of the parameters handled by resolveParameters in mistral
      expect(callArgs).not.toHaveProperty('frequency_penalty');
    });

    it('should handle payload with presence_penalty', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        presence_penalty: 0.5,
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      // presence_penalty is not part of the parameters handled by resolveParameters in mistral
      expect(callArgs).not.toHaveProperty('presence_penalty');
    });

    it('should handle empty messages array', async () => {
      await instance.chat({
        messages: [],
        model: 'open-mistral-7b',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [],
        }),
        expect.anything(),
      );
    });

    it('should handle tool_choice parameter', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: { name: 'test_tool', description: 'A test tool', parameters: {} },
        },
      ];

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        tools,
        tool_choice: 'auto',
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(callArgs.tools).toEqual(tools);
      // tool_choice is not explicitly handled in mistral handlePayload
    });

    it('should handle response_format parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        response_format: { type: 'json_object' },
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      // response_format is not explicitly handled in mistral handlePayload
      expect(callArgs).not.toHaveProperty('response_format');
    });

    it('should handle very small temperature values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 0.01,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.005, // 0.01 / 2
        }),
        expect.anything(),
      );
    });

    it('should handle decimal temperature values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 1.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.75, // 1.5 / 2
        }),
        expect.anything(),
      );
    });

    it('should handle very small top_p values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        top_p: 0.01,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          top_p: 0.01,
        }),
        expect.anything(),
      );
    });

    it('should handle large max_tokens values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        max_tokens: 100000,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 100000,
        }),
        expect.anything(),
      );
    });

    it('should handle complex message with multiple roles', async () => {
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
        model: 'open-mistral-7b',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages,
        }),
        expect.anything(),
      );
    });
  });
});
