// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeInternLMAI, params } from './index';

// Basic provider tests
testProvider({
  Runtime: LobeInternLMAI,
  provider: ModelProvider.InternLM,
  defaultBaseURL: 'https://chat.intern-ai.org.cn/api/v1',
  chatDebugEnv: 'DEBUG_INTERNLM_CHAT_COMPLETION',
  chatModel: 'internlm2_5-7b-chat',
  test: {
    skipAPICall: true,
  },
});

// Custom feature tests
describe('LobeInternLMAI - custom features', () => {
  let instance: InstanceType<typeof LobeInternLMAI>;

  beforeEach(() => {
    instance = new LobeInternLMAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params object', () => {
    it('should export params with correct baseURL', () => {
      expect(params.baseURL).toBe('https://chat.intern-ai.org.cn/api/v1');
    });

    it('should have correct provider', () => {
      expect(params.provider).toBe(ModelProvider.InternLM);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_INTERNLM_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_INTERNLM_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_INTERNLM_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should disable streaming when tools are present', () => {
      const payload = {
        model: 'internlm2_5-7b-chat',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        stream: true,
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'test',
              description: 'test function',
            },
          },
        ],
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.stream).toBe(false);
    });

    it('should enable streaming when no tools are present', () => {
      const payload = {
        model: 'internlm2_5-7b-chat',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        stream: true,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.stream).toBe(true);
    });

    it('should keep streaming disabled when initially false and no tools', () => {
      const payload = {
        model: 'internlm2_5-7b-chat',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        stream: false,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.stream).toBe(true);
    });

    it('should preserve other payload properties', () => {
      const payload = {
        model: 'internlm2_5-7b-chat',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        stream: true,
        temperature: 0.7,
        max_tokens: 100,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.model).toBe('internlm2_5-7b-chat');
      expect(result.messages).toEqual(payload.messages);
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(100);
    });
  });

  describe('models', () => {
    it('should fetch and process models', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'internlm2_5-7b-chat' },
              { id: 'internlm2_5-20b-chat' },
              { id: 'internvl-chat-2b' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
      expect(models.length).toBe(3);
      expect(mockClient.models.list).toHaveBeenCalled();
    });

    it('should detect function call capability from model name', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'internlm2_5-7b-chat' }, { id: 'internvl-chat-2b' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const internlmModel = models.find((m) => m.id === 'internlm2_5-7b-chat');
      const internvlModel = models.find((m) => m.id === 'internvl-chat-2b');

      expect(internlmModel?.functionCall).toBe(true);
      expect(internvlModel?.functionCall).toBe(false);
    });

    it('should detect vision capability from model name', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'internlm2_5-7b-chat' }, { id: 'internvl-chat-2b' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const internlmModel = models.find((m) => m.id === 'internlm2_5-7b-chat');
      const internvlModel = models.find((m) => m.id === 'internvl-chat-2b');

      expect(internlmModel?.vision).toBe(false);
      expect(internvlModel?.vision).toBe(true);
    });

    it('should handle case-insensitive keyword matching', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'InternLM2_5-7B-Chat' }, { id: 'InternVL-Chat-2B' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const internlmModel = models.find((m) => m.id === 'InternLM2_5-7B-Chat');
      const internvlModel = models.find((m) => m.id === 'InternVL-Chat-2B');

      expect(internlmModel?.functionCall).toBe(true);
      expect(internvlModel?.vision).toBe(true);
    });

    it('should merge with known model data from model-bank', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'internlm2_5-7b-chat' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should have properties from both API and model-bank
      expect(model.id).toBe('internlm2_5-7b-chat');
      expect(model.functionCall).toBeDefined();
      expect(model.vision).toBeDefined();
      expect(model.reasoning).toBeDefined();
    });

    it('should handle models not in model-bank', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'custom-model' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('custom-model');
      expect(model.contextWindowTokens).toBeUndefined();
      expect(model.displayName).toBeUndefined();
      expect(model.enabled).toBe(false);
      expect(model.functionCall).toBe(false);
      expect(model.vision).toBe(false);
      expect(model.reasoning).toBe(false);
    });

    it('should set enabled flag from known model', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'internlm2_5-7b-chat' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.enabled).toBeDefined();
    });

    it('should inherit abilities from known model', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'test-model-with-abilities' }],
          }),
        },
      };

      // Mock a model with abilities in model-bank
      vi.mock('model-bank', async (importOriginal) => {
        const actual = await importOriginal<typeof import('model-bank')>();
        return {
          ...actual,
          LOBE_DEFAULT_MODEL_LIST: [
            {
              id: 'test-model-with-abilities',
              abilities: {
                functionCall: true,
                vision: true,
                reasoning: true,
              },
              enabled: true,
            },
          ],
        };
      });

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('test-model-with-abilities');
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should filter out null/undefined models', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'valid-model' }, null, undefined],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models.length).toBe(1);
      expect(models[0].id).toBe('valid-model');
    });

    it('should set contextWindowTokens from known model', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'internlm2_5-7b-chat' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should have contextWindowTokens from model-bank if available
      expect(model.id).toBe('internlm2_5-7b-chat');
    });

    it('should set displayName from known model', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'internlm2_5-7b-chat' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should have displayName from model-bank if available
      expect(model.id).toBe('internlm2_5-7b-chat');
    });

    it('should combine keyword detection with known model abilities', async () => {
      const mockClient = {
        baseURL: 'https://chat.intern-ai.org.cn/api/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'internlm2_5-7b-chat' }, { id: 'internvl-chat-2b' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      // Models with matching keywords should have abilities set to true
      const internlmModel = models.find((m) => m.id === 'internlm2_5-7b-chat');
      const internvlModel = models.find((m) => m.id === 'internvl-chat-2b');

      expect(internlmModel?.functionCall).toBe(true);
      expect(internvlModel?.vision).toBe(true);
    });
  });
});
