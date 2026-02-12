// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeCohereAI, params } from './index';

const provider = ModelProvider.Cohere;
const defaultBaseURL = 'https://api.cohere.ai/compatibility/v1';

testProvider({
  Runtime: LobeCohereAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_COHERE_CHAT_COMPLETION',
  chatModel: 'command-r7b',
  test: {
    skipAPICall: true,
  },
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeCohereAI({ apiKey: 'test' });

  // Mock chat.completions.create method
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeCohereAI - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_COHERE_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_COHERE_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_COHERE_CHAT_COMPLETION;
    });
  });

  describe('handlePayload - parameter constraints', () => {
    it('should clamp frequency_penalty to [0, 1] range', async () => {
      // Test upper bound
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 1.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ frequency_penalty: 1 }),
        expect.anything(),
      );
    });

    it('should clamp frequency_penalty negative values to 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: -0.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ frequency_penalty: 0 }),
        expect.anything(),
      );
    });

    it('should clamp presence_penalty to [0, 1] range', async () => {
      // Test upper bound
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        presence_penalty: 1.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ presence_penalty: 1 }),
        expect.anything(),
      );
    });

    it('should clamp presence_penalty negative values to 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        presence_penalty: -0.3,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ presence_penalty: 0 }),
        expect.anything(),
      );
    });

    it('should clamp top_p to [0, 1] range', async () => {
      // Test upper bound
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        top_p: 1.2,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ top_p: 1 }),
        expect.anything(),
      );
    });

    it('should clamp top_p negative values to 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        top_p: -0.1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ top_p: 0 }),
        expect.anything(),
      );
    });

    it('should accept valid frequency_penalty values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 0.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ frequency_penalty: 0.5 }),
        expect.anything(),
      );
    });

    it('should accept valid presence_penalty values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        presence_penalty: 0.7,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ presence_penalty: 0.7 }),
        expect.anything(),
      );
    });

    it('should accept valid top_p values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        top_p: 0.9,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ top_p: 0.9 }),
        expect.anything(),
      );
    });

    it('should handle all penalty parameters together', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 0.3,
        presence_penalty: 0.4,
        top_p: 0.8,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 0.3,
          presence_penalty: 0.4,
          top_p: 0.8,
        }),
        expect.anything(),
      );
    });

    it('should handle boundary values correctly', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 0,
        presence_penalty: 1,
        top_p: 0.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 0,
          presence_penalty: 1,
          top_p: 0.5,
        }),
        expect.anything(),
      );
    });

    it('should not normalize temperature (keep original value)', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        temperature: 1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 1 }),
        expect.anything(),
      );
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        temperature: 0.5,
        max_tokens: 100,
        stream: true,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'command-r7b',
          temperature: 0.5,
          max_tokens: 100,
          stream: true,
        }),
        expect.anything(),
      );
    });

    it('should omit undefined penalty parameters', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        temperature: 0.5,
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('frequency_penalty');
      expect(callArgs).not.toHaveProperty('presence_penalty');
      expect(callArgs).not.toHaveProperty('top_p');
    });

    it('should handle edge case: all penalties at maximum', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 2,
        presence_penalty: 2,
        top_p: 2,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 1,
          presence_penalty: 1,
          top_p: 1,
        }),
        expect.anything(),
      );
    });

    it('should handle edge case: all penalties at minimum', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: -1,
        presence_penalty: -1,
        top_p: -1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 0,
          presence_penalty: 0,
          top_p: 0,
        }),
        expect.anything(),
      );
    });
  });

  describe('handlePayload - excludeUsage and noUserId', () => {
    it('should verify excludeUsage is set to true', () => {
      expect(params.chatCompletion.excludeUsage).toBe(true);
    });

    it('should verify noUserId is set to true', () => {
      expect(params.chatCompletion.noUserId).toBe(true);
    });
  });

  describe('models', () => {
    const mockClient = {
      baseURL: 'https://api.cohere.ai/compatibility/v1',
      models: {
        list: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models with tools support', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: false,
            },
            {
              name: 'command-r',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'command-r-plus',
        contextWindowTokens: 128000,
        functionCall: true, // Has tools in features
        vision: false,
      });
      expect(models[1]).toMatchObject({
        id: 'command-r',
        contextWindowTokens: 128000,
        functionCall: true, // Has tools in features
        vision: false,
      });
    });

    it('should detect vision support from supports_vision flag', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus-08-2024',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: true,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'command-r-plus-08-2024',
        vision: true,
      });
    });

    it('should handle models without features (null)', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command',
              context_length: 4096,
              features: null,
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'command',
        contextWindowTokens: 4096,
        functionCall: false, // No tools in features, fallback to known model
        vision: false,
      });
    });

    it('should handle models with features but no tools', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-light',
              context_length: 4096,
              features: ['chat'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'command-light',
        functionCall: false, // No tools in features
        vision: false,
      });
    });

    it('should merge with known model list for display name and enabled status', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Should have displayName and enabled from LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
      expect(models[0].enabled).toBeDefined();
    });

    it('should handle models not in known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'unknown-cohere-model',
              context_length: 8192,
              features: ['chat'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'unknown-cohere-model',
        contextWindowTokens: 8192,
        displayName: undefined,
        enabled: false,
        functionCall: false,
        vision: false,
      });
    });

    it('should handle case-insensitive model matching', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'COMMAND-R-PLUS',
              context_length: 128000,
              features: ['tools'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('COMMAND-R-PLUS');
      // Should match with lowercase in LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
    });

    it('should combine capabilities from both API and known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Should combine API features with known model abilities
      expect(models[0].functionCall).toBe(true); // From features
      expect(models[0].vision).toBe(false); // From API
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should change client baseURL to v1 endpoint', async () => {
      const clientWithBaseURL = {
        baseURL: 'https://api.cohere.ai/compatibility/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            body: { models: [] },
          }),
        },
      };

      await params.models({ client: clientWithBaseURL as any });

      expect(clientWithBaseURL.baseURL).toBe('https://api.cohere.com/v1');
    });

    it('should handle models with all capabilities', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus-vision',
              context_length: 128000,
              features: ['tools', 'chat', 'vision'],
              supports_vision: true,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'command-r-plus-vision',
        contextWindowTokens: 128000,
        functionCall: true,
        vision: true,
      });
    });

    it('should preserve abilities from known model list when API has no features', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus',
              context_length: 128000,
              features: null,
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Should use known model abilities as fallback
      expect(models[0].functionCall).toBeDefined();
    });

    it('should handle models with various context lengths', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-light',
              context_length: 4096,
              features: ['chat'],
              supports_vision: false,
            },
            {
              name: 'command-r',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: false,
            },
            {
              name: 'command-r-plus',
              context_length: 256000,
              features: ['tools', 'chat'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0].contextWindowTokens).toBe(4096);
      expect(models[1].contextWindowTokens).toBe(128000);
      expect(models[2].contextWindowTokens).toBe(256000);
    });

    it('should handle complex features array', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus',
              context_length: 128000,
              features: ['tools', 'chat', 'embeddings', 'rerank'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].functionCall).toBe(true); // Should detect tools
    });

    it('should handle API errors gracefully', async () => {
      mockClient.models.list.mockRejectedValue(new Error('API Error'));

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should handle network timeout errors', async () => {
      mockClient.models.list.mockRejectedValue(new Error('Network timeout'));

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('Network timeout');
    });

    it('should handle invalid API response structure', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          // Missing models array
        },
      });

      // Should throw error when trying to map over undefined
      await expect(params.models({ client: mockClient as any })).rejects.toThrow();
    });

    it('should handle malformed model data', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              // Missing required fields
              name: 'incomplete-model',
            } as any,
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('incomplete-model');
      // Should handle undefined values
      expect(models[0].contextWindowTokens).toBeUndefined();
    });

    it('should verify baseURL changes to v1 endpoint for models API', async () => {
      const customClient = {
        baseURL: 'https://api.cohere.ai/compatibility/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            body: {
              models: [
                {
                  name: 'test-model',
                  context_length: 8000,
                  features: ['chat'],
                  supports_vision: false,
                },
              ],
            },
          }),
        },
      };

      await params.models({ client: customClient as any });

      // Should mutate baseURL to v1
      expect(customClient.baseURL).toBe('https://api.cohere.com/v1');
    });

    it('should handle very large context lengths', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus-extended',
              context_length: 1000000,
              features: ['tools'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].contextWindowTokens).toBe(1000000);
    });

    it('should handle models with zero context length', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'test-model',
              context_length: 0,
              features: null,
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].contextWindowTokens).toBe(0);
    });

    it('should merge vision capability from both API and known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus-08-2024',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: true,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Vision should be true from either API or known model list
      expect(models[0].vision).toBe(true);
    });

    it('should correctly filter and map all model fields', async () => {
      mockClient.models.list.mockResolvedValue({
        body: {
          models: [
            {
              name: 'command-r-plus',
              context_length: 128000,
              features: ['tools', 'chat'],
              supports_vision: true,
            },
            {
              name: 'command-r',
              context_length: 128000,
              features: ['tools'],
              supports_vision: false,
            },
          ],
        },
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);

      // Verify all required fields are present
      models.forEach((model) => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('contextWindowTokens');
        expect(model).toHaveProperty('functionCall');
        expect(model).toHaveProperty('vision');
        expect(model).toHaveProperty('enabled');
      });
    });
  });

  describe('baseURL configuration', () => {
    it('should use correct default baseURL', () => {
      expect(params.baseURL).toBe('https://api.cohere.ai/compatibility/v1');
    });

    it('should initialize instance with custom baseURL', () => {
      const customInstance = new LobeCohereAI({
        apiKey: 'test',
        baseURL: 'https://custom.cohere.ai/v1',
      });

      expect(customInstance).toBeDefined();
    });
  });

  describe('provider configuration', () => {
    it('should have correct provider ID', () => {
      expect(params.provider).toBe(ModelProvider.Cohere);
    });

    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params).toHaveProperty('baseURL');
      expect(params).toHaveProperty('chatCompletion');
      expect(params).toHaveProperty('debug');
      expect(params).toHaveProperty('models');
      expect(params).toHaveProperty('provider');
    });
  });

  describe('chatCompletion configuration', () => {
    it('should have excludeUsage set to true', () => {
      expect(params.chatCompletion.excludeUsage).toBe(true);
    });

    it('should have noUserId set to true', () => {
      expect(params.chatCompletion.noUserId).toBe(true);
    });

    it('should have handlePayload function', () => {
      expect(params.chatCompletion.handlePayload).toBeDefined();
      expect(typeof params.chatCompletion.handlePayload).toBe('function');
    });
  });

  describe('edge cases for payload handling', () => {
    it('should handle missing optional parameters gracefully', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        // No temperature, frequency_penalty, presence_penalty, or top_p
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(callArgs).toHaveProperty('messages');
      expect(callArgs).toHaveProperty('model');
      expect(callArgs).not.toHaveProperty('temperature');
      expect(callArgs).not.toHaveProperty('frequency_penalty');
      expect(callArgs).not.toHaveProperty('presence_penalty');
      expect(callArgs).not.toHaveProperty('top_p');
    });

    it('should handle very small positive penalty values', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 0.001,
        presence_penalty: 0.0001,
        top_p: 0.01,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 0.001,
          presence_penalty: 0.0001,
          top_p: 0.01,
        }),
        expect.anything(),
      );
    });

    it('should handle exact boundary values (0 and 1)', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 1,
        presence_penalty: 0,
        top_p: 1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 1,
          presence_penalty: 0,
          top_p: 1,
        }),
        expect.anything(),
      );
    });

    it('should handle multiple messages with different roles', async () => {
      await instance.chat({
        messages: [
          { content: 'System prompt', role: 'system' },
          { content: 'User message 1', role: 'user' },
          { content: 'Assistant response', role: 'assistant' },
          { content: 'User message 2', role: 'user' },
        ],
        model: 'command-r7b',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { content: 'System prompt', role: 'system' },
            { content: 'User message 1', role: 'user' },
            { content: 'Assistant response', role: 'assistant' },
            { content: 'User message 2', role: 'user' },
          ],
        }),
        expect.anything(),
      );
    });

    it('should handle max_tokens parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        max_tokens: 4096,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
        }),
        expect.anything(),
      );
    });

    it('should handle stream parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        stream: true,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
        }),
        expect.anything(),
      );
    });

    it('should handle tools parameter', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        tools,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
        }),
        expect.anything(),
      );
    });

    it('should handle combined complex payload', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'calculate',
            description: 'Calculate',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      await instance.chat({
        messages: [
          { content: 'System', role: 'system' },
          { content: 'Hello', role: 'user' },
        ],
        model: 'command-r-plus',
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.95,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        stream: true,
        tools,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { content: 'System', role: 'system' },
            { content: 'Hello', role: 'user' },
          ],
          model: 'command-r-plus',
          temperature: 0.7,
          max_tokens: 2048,
          top_p: 0.95,
          frequency_penalty: 0.1,
          presence_penalty: 0.2,
          stream: true,
          tools,
        }),
        expect.anything(),
      );
    });

    it('should handle extreme out-of-range values correctly', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        frequency_penalty: 10,
        presence_penalty: -5,
        top_p: 100,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 1, // Clamped to max
          presence_penalty: 0, // Clamped to min
          top_p: 1, // Clamped to max
        }),
        expect.anything(),
      );
    });

    it('should handle temperature parameter when present', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'command-r7b',
        temperature: 0.7,
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.7);
    });

    it('should not modify messages array', async () => {
      const messages = [
        { content: 'User message', role: 'user' as const },
        { content: 'Assistant reply', role: 'assistant' as const },
      ];

      await instance.chat({
        messages,
        model: 'command-r7b',
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
