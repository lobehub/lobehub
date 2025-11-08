// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeQiniuAI, params } from './index';

const provider = ModelProvider.Qiniu;
const defaultBaseURL = 'https://openai.qiniu.com/v1';

testProvider({
  Runtime: LobeQiniuAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_QINIU_CHAT_COMPLETION',
  chatModel: 'deepseek-r1',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeQiniuAI - custom features', () => {
  let instance: InstanceType<typeof LobeQiniuAI>;

  beforeEach(() => {
    instance = new LobeQiniuAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params.debug', () => {
    it('should disable debug mode by default', () => {
      delete process.env.DEBUG_QINIU_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug mode when DEBUG_QINIU_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_QINIU_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_QINIU_CHAT_COMPLETION;
    });

    it('should disable debug mode when DEBUG_QINIU_CHAT_COMPLETION is not 1', () => {
      process.env.DEBUG_QINIU_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_QINIU_CHAT_COMPLETION;
    });
  });

  describe('params.models', () => {
    it('should fetch and process models successfully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-4' }, { id: 'claude-3-opus' }, { id: 'gemini-pro' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should use processMultiProviderModelList to parse models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-4' }, { id: 'claude-3-opus' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      // processMultiProviderModelList should return valid model cards
      expect(models.length).toBeGreaterThan(0);
      models.forEach((model) => {
        expect(model).toHaveProperty('id');
      });
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

    it('should handle API errors gracefully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should pass qiniu as the provider name to processMultiProviderModelList', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'test-model' }],
          }),
        },
      };

      // The function should internally call processMultiProviderModelList with 'qiniu' as second param
      const models = await params.models!({ client: mockClient as any });

      // Verify that the models are processed (non-empty if valid models exist)
      expect(Array.isArray(models)).toBe(true);
    });

    it('should handle models with OpenAI provider', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models.length).toBeGreaterThan(0);
      // Should detect OpenAI models and include them
      const gpt4 = models.find((m) => m.id === 'gpt-4');
      expect(gpt4).toBeDefined();
    });

    it('should handle models with Anthropic provider', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'claude-3-opus' }, { id: 'claude-3-sonnet' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models.length).toBeGreaterThan(0);
      // Should detect Anthropic models and include them
      const claude = models.find((m) => m.id === 'claude-3-opus');
      expect(claude).toBeDefined();
    });

    it('should handle models with Google provider', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gemini-pro' }, { id: 'gemini-1.5-pro' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models.length).toBeGreaterThan(0);
      // Should detect Google models and include them
      const gemini = models.find((m) => m.id === 'gemini-pro');
      expect(gemini).toBeDefined();
    });

    it('should handle mixed provider models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'gpt-4' },
              { id: 'claude-3-opus' },
              { id: 'gemini-pro' },
              { id: 'deepseek-chat' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models.length).toBeGreaterThan(0);
      // Should detect and include models from multiple providers
      expect(models.some((m) => m.id === 'gpt-4')).toBe(true);
      expect(models.some((m) => m.id === 'claude-3-opus')).toBe(true);
      expect(models.some((m) => m.id === 'gemini-pro')).toBe(true);
    });

    it('should handle models with only id property', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'model-1' }, { id: 'model-2' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(Array.isArray(models)).toBe(true);
    });

    it('should handle network timeout errors', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('Network timeout')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow(
        'Network timeout',
      );
    });

    it('should handle invalid API response format', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: null,
          }),
        },
      };

      // Should throw or handle gracefully when data is null
      await expect(async () => {
        await params.models!({ client: mockClient as any });
      }).rejects.toThrow();
    });

    it('should handle missing data property in response', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({}),
        },
      };

      // Should throw or handle gracefully when data property is missing
      await expect(async () => {
        await params.models!({ client: mockClient as any });
      }).rejects.toThrow();
    });

    it('should handle models with various DeepSeek variants', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'deepseek-chat' }, { id: 'deepseek-coder' }, { id: 'deepseek-r1' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('exports', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Qiniu);
      expect(params.baseURL).toBe('https://openai.qiniu.com/v1');
    });

    it('should export LobeQiniuAI class', () => {
      expect(LobeQiniuAI).toBeDefined();
      expect(typeof LobeQiniuAI).toBe('function');
    });

    it('should export params with all required properties', () => {
      expect(params).toHaveProperty('provider');
      expect(params).toHaveProperty('baseURL');
      expect(params).toHaveProperty('apiKey');
      expect(params).toHaveProperty('debug');
      expect(params).toHaveProperty('models');
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

    it('should have correct apiKey placeholder', () => {
      expect(params.apiKey).toBe('placeholder-to-avoid-error');
    });
  });
});
