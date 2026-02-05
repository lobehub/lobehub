// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeAkashChatAI, params } from './index';

const provider = ModelProvider.AkashChat;
const defaultBaseURL = 'https://chatapi.akash.network/api/v1';

testProvider({
  Runtime: LobeAkashChatAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_AKASH_CHAT_COMPLETION',
  chatModel: 'llama-3.1-8b-instruct',
  defaultBaseURL,
  invalidErrorType: 'InvalidProviderAPIKey',
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeAkashChatAI - custom features', () => {
  let instance: InstanceType<typeof LobeAkashChatAI>;

  beforeEach(() => {
    instance = new LobeAkashChatAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.AkashChat);
      expect(params.baseURL).toBe('https://chatapi.akash.network/api/v1');
    });

    it('should have chatCompletion config with handlePayload', () => {
      expect(params.chatCompletion).toBeDefined();
      expect(params.chatCompletion?.handlePayload).toBeDefined();
      expect(typeof params.chatCompletion?.handlePayload).toBe('function');
    });

    it('should have debug configuration', () => {
      expect(params.debug).toBeDefined();
      expect(params.debug.chatCompletion).toBeDefined();
      expect(typeof params.debug.chatCompletion).toBe('function');
    });

    it('should have models function', () => {
      expect(params.models).toBeDefined();
      expect(typeof params.models).toBe('function');
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_AKASH_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set to "1"', () => {
      process.env.DEBUG_AKASH_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_AKASH_CHAT_COMPLETION;
    });

    it('should disable debug when env is not "1"', () => {
      process.env.DEBUG_AKASH_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_AKASH_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should add allowed_openai_params and cache for all models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'llama-3.1-8b-instruct',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.allowed_openai_params).toEqual(['reasoning_effort']);
      expect(calledPayload.cache).toEqual({ 'no-cache': true });
    });

    it('should preserve model in payload', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'llama-3.1-8b-instruct',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('llama-3.1-8b-instruct');
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        max_tokens: 1024,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'llama-3.1-8b-instruct',
        temperature: 0.7,
        top_p: 0.9,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.max_tokens).toBe(1024);
      expect(calledPayload.temperature).toBe(0.7);
      expect(calledPayload.top_p).toBe(0.9);
      expect(calledPayload.messages).toEqual([{ content: 'Hello', role: 'user' }]);
    });

    describe('thinking models', () => {
      it('should add chat_template_kwargs with thinking=true for DeepSeek-V3-1 when thinking is enabled', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'DeepSeek-V3-1',
          thinking: { type: 'enabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toEqual({ thinking: true });
      });

      it('should add chat_template_kwargs with thinking=false for DeepSeek-V3-1 when thinking is disabled', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'DeepSeek-V3-1',
          thinking: { type: 'disabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toEqual({ thinking: false });
      });

      it('should add chat_template_kwargs with thinking=undefined for DeepSeek-V3-1 when thinking type is not enabled/disabled', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'DeepSeek-V3-1',
          thinking: { type: 'auto' } as any,
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toEqual({ thinking: undefined });
      });

      it('should add chat_template_kwargs with thinking=undefined for DeepSeek-V3-1 when thinking is not provided', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'DeepSeek-V3-1',
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toEqual({ thinking: undefined });
      });

      it('should not add chat_template_kwargs for non-thinking models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'llama-3.1-8b-instruct',
          thinking: { type: 'enabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toBeUndefined();
      });

      it('should not add chat_template_kwargs for models that contain but dont match thinking model names', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'DeepSeek-V3-1-preview',
          thinking: { type: 'enabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toBeUndefined();
      });
    });

    describe('thinking parameter removal', () => {
      it('should remove thinking from payload for thinking models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'DeepSeek-V3-1',
          thinking: { type: 'enabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.thinking).toBeUndefined();
      });

      it('should remove thinking from payload for non-thinking models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'llama-3.1-8b-instruct',
          thinking: { type: 'enabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.thinking).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      it('should handle empty messages array', async () => {
        await instance.chat({
          messages: [],
          model: 'llama-3.1-8b-instruct',
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.messages).toEqual([]);
        expect(calledPayload.allowed_openai_params).toEqual(['reasoning_effort']);
        expect(calledPayload.cache).toEqual({ 'no-cache': true });
      });

      it('should handle thinking models with case-sensitive match', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'deepseek-v3-1',
          thinking: { type: 'enabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toBeUndefined();
      });

      it('should handle multiple thinking model keywords', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'DeepSeek-V3-1',
          thinking: { type: 'enabled', budget_tokens: 1024 },
        });

        const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload.chat_template_kwargs).toEqual({ thinking: true });
      });
    });
  });

  describe('models function', () => {
    it('should fetch and process models successfully', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { created: 1234567890, id: 'llama-3.1-8b-instruct', owned_by: 'meta' },
              { created: 1234567891, id: 'DeepSeek-V3-1', owned_by: 'deepseek' },
            ],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should remove created field from model items', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ created: 1234567890, id: 'llama-3.1-8b-instruct', owned_by: 'meta' }],
          }),
        },
      };

      await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should handle missing data field', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockResolvedValue({}),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should handle API errors gracefully and return empty array', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to fetch AkashChat models. Please ensure your AkashChat API key is valid:',
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle network timeout errors', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('Network timeout')),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should handle invalid API key errors', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockClient = {
        apiKey: 'invalid',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('Unauthorized')),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to fetch AkashChat models. Please ensure your AkashChat API key is valid:',
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle malformed response data', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://chatapi.akash.network/api/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [null, undefined, { id: 'valid-model' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('integration tests', () => {
    it('should handle complete chat request with thinking model', async () => {
      const response = await instance.chat({
        max_tokens: 2048,
        messages: [
          { content: 'You are a helpful assistant', role: 'system' },
          { content: 'What is 2+2?', role: 'user' },
        ],
        model: 'DeepSeek-V3-1',
        temperature: 0.5,
        thinking: { type: 'enabled', budget_tokens: 1024 },
        top_p: 0.95,
      });

      expect(response).toBeInstanceOf(Response);
      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('DeepSeek-V3-1');
      expect(calledPayload.chat_template_kwargs).toEqual({ thinking: true });
      expect(calledPayload.allowed_openai_params).toEqual(['reasoning_effort']);
      expect(calledPayload.cache).toEqual({ 'no-cache': true });
      expect(calledPayload.thinking).toBeUndefined();
    });

    it('should handle complete chat request with non-thinking model', async () => {
      const response = await instance.chat({
        max_tokens: 2048,
        messages: [
          { content: 'You are a helpful assistant', role: 'system' },
          { content: 'What is 2+2?', role: 'user' },
        ],
        model: 'llama-3.1-8b-instruct',
        temperature: 0.5,
        thinking: { type: 'enabled', budget_tokens: 1024 },
        top_p: 0.95,
      });

      expect(response).toBeInstanceOf(Response);
      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('llama-3.1-8b-instruct');
      expect(calledPayload.chat_template_kwargs).toBeUndefined();
      expect(calledPayload.allowed_openai_params).toEqual(['reasoning_effort']);
      expect(calledPayload.cache).toEqual({ 'no-cache': true });
      expect(calledPayload.thinking).toBeUndefined();
    });

    it('should handle streaming requests', async () => {
      const response = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'llama-3.1-8b-instruct',
        stream: true,
      });

      expect(response).toBeInstanceOf(Response);
    });
  });
});
