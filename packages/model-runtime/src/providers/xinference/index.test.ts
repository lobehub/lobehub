// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { XinferenceModelCard } from './index';
import { LobeXinferenceAI } from './index';

describe('LobeXinferenceAI - custom features', () => {
  let instance: InstanceType<typeof LobeXinferenceAI>;

  beforeEach(() => {
    instance = new LobeXinferenceAI({ apiKey: 'test_api_key' });
  });

  describe('models', () => {
    it('should fetch and process model list correctly', async () => {
      const mockModelList: XinferenceModelCard[] = [
        {
          context_length: 4096,
          id: 'qwen-7b',
          model_ability: ['chat', 'tools', 'vision'],
          model_description: 'Qwen 7B model',
          model_type: 'LLM',
          name: 'Qwen 7B',
        },
        {
          context_length: 8192,
          id: 'llama-2-13b',
          model_ability: ['chat', 'reasoning'],
          model_description: 'Llama 2 13B model',
          model_type: 'LLM',
          name: 'Llama 2 13B',
        },
      ];

      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({
        data: mockModelList,
      } as any);

      const models = await instance.models();

      expect(instance['client'].models.list).toHaveBeenCalled();
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'qwen-7b',
        displayName: 'Qwen 7B',
        contextWindowTokens: 4096,
        description: 'Qwen 7B model',
        functionCall: true,
        vision: true,
        reasoning: false,
      });
      expect(models[1]).toMatchObject({
        id: 'llama-2-13b',
        displayName: 'Llama 2 13B',
        contextWindowTokens: 8192,
        description: 'Llama 2 13B model',
        functionCall: false,
        vision: false,
        reasoning: true,
      });
    });

    it('should handle empty model list', async () => {
      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({
        data: [],
      } as any);

      const models = await instance.models();

      expect(models).toEqual([]);
    });
  });

  describe('debug', () => {
    it('should enable request debug when DEBUG_XINFERENCE_CHAT_COMPLETION is set to 1', async () => {
      process.env.DEBUG_XINFERENCE_CHAT_COMPLETION = '1';
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
        new ReadableStream() as any,
      );
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'test-model',
      });

      expect(logSpy).toHaveBeenCalledWith('[requestPayload]');

      logSpy.mockRestore();
      delete process.env.DEBUG_XINFERENCE_CHAT_COMPLETION;
    });
  });
});
