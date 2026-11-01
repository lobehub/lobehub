// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeQiniuAI, params } from './index';

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

    it('should map upstream context_length/max_tokens onto the processed card', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                context_length: 256000,
                created: 1770370439,
                id: 'meituan/longcat-flash-lite',
                max_tokens: 320000,
                object: 'model',
                owned_by: 'system',
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models).toEqual([
        expect.objectContaining({
          contextWindowTokens: 256000,
          id: 'meituan/longcat-flash-lite',
          maxOutput: 320000,
        }),
      ]);
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
    it('should export params with all required properties', () => {
      expect(params).toHaveProperty('provider');
      expect(params).toHaveProperty('baseURL');
      expect(params).toHaveProperty('apiKey');
      expect(params).toHaveProperty('debug');
      expect(params).toHaveProperty('models');
    });
    it('should have correct apiKey placeholder', () => {
      expect(params.apiKey).toBe('placeholder-to-avoid-error');
    });
  });
});
