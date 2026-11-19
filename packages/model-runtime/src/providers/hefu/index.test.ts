// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeHeFuAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

// Basic provider tests
testProvider({
  Runtime: LobeHeFuAI,
  chatDebugEnv: 'DEBUG_HEFU_CHAT_COMPLETION',
  chatModel: 'deepseek-v4-flash',
  defaultBaseURL: 'https://api.hefu.hk/v1',
  provider: ModelProvider.HeFu,
  test: {
    skipAPICall: true,
  },
});

// Custom feature tests
describe('LobeHeFuAI - custom features', () => {
  describe('params object', () => {
    it('should export params with correct baseURL', () => {
      expect(params.baseURL).toBe('https://api.hefu.hk/v1');
    });

    it('should have correct provider', () => {
      expect(params.provider).toBe(ModelProvider.HeFu);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_HEFU_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_HEFU_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_HEFU_CHAT_COMPLETION;
    });
  });

  describe('models', () => {
    it('should fetch and process models', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.hefu.hk/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
              { id: 'gpt-5.5', object: 'model', owned_by: 'openai' },
              { id: 'claude-sonnet-4-6', object: 'model', owned_by: 'anthropic' },
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
        baseURL: 'https://api.hefu.hk/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('deepseek-v4-flash');
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.hefu.hk/v1',
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
        baseURL: 'https://api.hefu.hk/v1',
        models: {
          list: vi.fn().mockResolvedValue({}),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle API error gracefully', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.hefu.hk/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should merge with known model data from model-bank', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.hefu.hk/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should have properties from both API and model-bank
      expect(model.id).toBe('deepseek-v4-flash');
    });

    it('should handle models not in model-bank', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.hefu.hk/v1',
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
  });
});
