// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeAvalAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

// Basic provider tests
testProvider({
  Runtime: LobeAvalAI,
  chatDebugEnv: 'DEBUG_AVALAI_COMPLETION',
  chatModel: 'gpt-4o-mini',
  defaultBaseURL: 'https://api.avalai.ir/v1',
  provider: ModelProvider.AvalAI,
  test: {
    skipAPICall: true,
  },
});

// Custom feature tests
describe('LobeAvalAI - custom features', () => {
  describe('params object', () => {
    it('should export params with correct baseURL', () => {
      expect(params.baseURL).toBe('https://api.avalai.ir/v1');
    });

    it('should have correct provider', () => {
      expect(params.provider).toBe(ModelProvider.AvalAI);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_AVALAI_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_AVALAI_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_AVALAI_COMPLETION;
    });
  });

  describe('models function', () => {
    it('should filter and process model list correctly', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
              { id: 'claude-sonnet-4-20250514', object: 'model', owned_by: 'anthropic' },
            ],
          }),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: [] }),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(result).toEqual([]);
    });
  });
});
