// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeLLMTRAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

describe('LobeLLMTRAI', () => {
  let instance: InstanceType<typeof LobeLLMTRAI>;

  beforeEach(() => {
    instance = new LobeLLMTRAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params object', () => {
    it('should export params with the LLMTR base URL', () => {
      expect(params.baseURL).toBe('https://llmtr.com/v1');
    });

    it('should have the LLMTR provider id', () => {
      expect(params.provider).toBe(ModelProvider.LLMTR);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_LLMTR_COMPLETION;
      expect(params.debug.chatCompletion()).toBe(false);
    });

    it('should enable debug when the env is set', () => {
      process.env.DEBUG_LLMTR_COMPLETION = '1';
      expect(params.debug.chatCompletion()).toBe(true);
      delete process.env.DEBUG_LLMTR_COMPLETION;
    });
  });

  describe('runtime', () => {
    it('should construct a runtime with the test API key', () => {
      expect(instance).toBeInstanceOf(LobeLLMTRAI);
    });
  });

  describe('models', () => {
    it('should map a models.list payload through processMultiProviderModelList', async () => {
      const list = vi.fn().mockResolvedValue({
        data: [{ id: 'qwen/qwen-flash', object: 'model', owned_by: 'llmtr' }],
      });
      const result = await params.models({ client: { models: { list } } } as any);
      expect(list).toHaveBeenCalledTimes(1);
      expect(Array.isArray(result)).toBe(true);
      expect(result.some((item: { id: string }) => item.id === 'qwen/qwen-flash')).toBe(true);
    });
  });
});
