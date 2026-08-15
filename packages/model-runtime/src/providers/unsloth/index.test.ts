// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeUnslothAI, params } from './index';

const provider = ModelProvider.Unsloth;
const defaultBaseURL = 'http://127.0.0.1:8000/v1';

testProvider({
  Runtime: LobeUnslothAI,
  chatDebugEnv: 'DEBUG_UNSLOTH_CHAT_COMPLETION',
  chatModel: 'unsloth/Qwen3-1.7B-GGUF',
  defaultBaseURL,
  provider,
  test: {
    skipAPICall: true,
  },
});

describe('LobeUnslothAI - custom features', () => {
  describe('params export', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Unsloth);
      expect(params.baseURL).toBe('http://127.0.0.1:8000/v1');
      expect(params.apiKey).toBe('placeholder-to-avoid-error');
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should return false when DEBUG_UNSLOTH_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_UNSLOTH_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion()).toBe(false);
    });

    it('should return true when DEBUG_UNSLOTH_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_UNSLOTH_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion()).toBe(true);
      delete process.env.DEBUG_UNSLOTH_CHAT_COMPLETION;
    });
  });

  describe('models function', () => {
    it('should fetch and enrich known models from LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'unsloth/Qwen3-1.7B-GGUF' }, { id: 'custom-local-model' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toHaveLength(2);

      const known = models.find((m) => m.id === 'unsloth/Qwen3-1.7B-GGUF');
      expect(known?.displayName).toBe('Qwen3 1.7B');
      expect(known?.functionCall).toBe(true);

      const unknown = models.find((m) => m.id === 'custom-local-model');
      expect(unknown?.enabled).toBe(false);
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: [] }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });
  });
});
