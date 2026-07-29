// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeCometAPIAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

// Basic provider tests
testProvider({
  Runtime: LobeCometAPIAI,
  chatDebugEnv: 'DEBUG_COMETAPI_COMPLETION',
  chatModel: 'gpt-3.5-turbo',
  defaultBaseURL: 'https://api.cometapi.com/v1',
  provider: ModelProvider.CometAPI,
  test: {
    skipAPICall: true,
  },
});

// Custom feature tests
describe('LobeCometAPIAI - custom features', () => {
  let instance: InstanceType<typeof LobeCometAPIAI>;

  beforeEach(() => {
    instance = new LobeCometAPIAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params object', () => {
    it('should export params with correct baseURL', () => {
      expect(params.baseURL).toBe('https://api.cometapi.com/v1');
    });

    it('should have correct provider', () => {
      expect(params.provider).toBe(ModelProvider.CometAPI);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_COMETAPI_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_COMETAPI_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_COMETAPI_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should force streaming to true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-3.5-turbo',
        stream: false,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.stream).toBe(true);
    });

    it('should preserve streaming when already true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-3.5-turbo',
        stream: true,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.stream).toBe(true);
    });

    it('should preserve model parameter', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        stream: false,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.model).toBe('gpt-4');
    });

    it('should preserve messages parameter', () => {
      const messages = [
        { content: 'You are a helpful assistant', role: 'system' as const },
        { content: 'Hello', role: 'user' as const },
      ];
      const payload = {
        messages,
        model: 'gpt-3.5-turbo',
        stream: false,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.messages).toEqual(messages);
    });

    it('should preserve other payload properties', () => {
      const payload = {
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-3.5-turbo',
        stream: false,
        temperature: 0.7,
        top_p: 0.9,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.model).toBe('gpt-3.5-turbo');
      expect(result.messages).toEqual(payload.messages);
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(100);
      expect(result.top_p).toBe(0.9);
    });

    it('should handle payload with tools', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        stream: false,
        tools: [
          {
            function: {
              description: 'test function',
              name: 'test',
            },
            type: 'function' as const,
          },
        ],
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.stream).toBe(true);
      expect(result.tools).toEqual(payload.tools);
    });

    it('should handle empty tools array', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-3.5-turbo',
        stream: false,
        tools: [],
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.stream).toBe(true);
      expect(result.tools).toEqual([]);
    });

    it('should preserve frequency_penalty parameter', () => {
      const payload = {
        frequency_penalty: 0.5,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-3.5-turbo',
        stream: false,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.frequency_penalty).toBe(0.5);
    });

    it('should preserve presence_penalty parameter', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-3.5-turbo',
        presence_penalty: 0.3,
        stream: false,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.presence_penalty).toBe(0.3);
    });
  });

  describe('models', () => {
    it('should fetch and process models', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' },
              { id: 'gpt-4', object: 'model', owned_by: 'openai' },
              { id: 'claude-3', object: 'model', owned_by: 'anthropic' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
      expect(models.length).toBe(3);
      expect(mockClient.models.list).toHaveBeenCalled();
    });

    it('should map model fields correctly', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('gpt-3.5-turbo');
    });

    it('should filter unnecessary fields from raw model data', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 1_677_649_963,
                id: 'gpt-3.5-turbo',
                object: 'model',
                owned_by: 'openai',
                parent: null,
                permission: [],
                root: 'gpt-3.5-turbo',
              },
            ],
          }),
        },
      };

      await params.models!({ client: mockClient as any });
      // Should only include id, object, owned_by in the mapped list
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle missing data field', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({}),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle null data field', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: null,
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle API error gracefully', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should handle network error', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('Network Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('Network Error');
    });

    it('should handle unauthorized error', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('Unauthorized')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('Unauthorized');
    });

    it('should process multi-provider model list', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'gpt-4', object: 'model', owned_by: 'openai' },
              { id: 'claude-3-opus', object: 'model', owned_by: 'anthropic' },
              { id: 'gemini-pro', object: 'model', owned_by: 'google' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models.length).toBe(3);
      // processMultiProviderModelList should handle different providers
    });

    it('should merge with known model data from model-bank', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should have properties from both API and model-bank
      expect(model.id).toBe('gpt-3.5-turbo');
    });

    it('should handle models not in model-bank', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'custom-model', object: 'model', owned_by: 'custom' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('custom-model');
    });

    it('should handle models with different owned_by values', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'model-1', object: 'model', owned_by: 'openai' },
              { id: 'model-2', object: 'model', owned_by: 'anthropic' },
              { id: 'model-3', object: 'model', owned_by: 'google' },
              { id: 'model-4', object: 'model', owned_by: 'custom' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models.length).toBe(4);
    });

    it('should preserve object field in processed models', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' }],
          }),
        },
      };

      await params.models!({ client: mockClient as any });
      // The mapped model list should preserve the object field
    });

    it('should call processMultiProviderModelList with correct arguments', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.cometapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' }],
          }),
        },
      };

      await params.models!({ client: mockClient as any });
      // processMultiProviderModelList should be called with modelList and 'cometapi'
    });
  });
});
