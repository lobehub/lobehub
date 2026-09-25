// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VLLMModelCard } from './index';
import { LobeVLLMAI } from './index';

describe('LobeVLLMAI - custom features', () => {
  let instance: InstanceType<typeof LobeVLLMAI>;

  beforeEach(() => {
    instance = new LobeVLLMAI({ apiKey: 'test_api_key' });
  });

  describe('models', () => {
    it('should fetch and process model list correctly', async () => {
      const mockModelList: VLLMModelCard[] = [
        { id: 'meta-llama/Llama-2-7b-chat-hf' },
        { id: 'mistralai/Mistral-7B-Instruct-v0.1' },
        { id: 'qwen/Qwen-7B-Chat' },
      ];

      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({
        data: mockModelList,
      } as any);

      const models = await instance.models();

      expect(instance['client'].models.list).toHaveBeenCalled();
      expect(models).toHaveLength(3);
      expect(models[0]).toMatchObject({
        id: 'meta-llama/Llama-2-7b-chat-hf',
      });
      expect(models[1]).toMatchObject({
        id: 'mistralai/Mistral-7B-Instruct-v0.1',
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
    it('should enable request debug when DEBUG_VLLM_CHAT_COMPLETION is set to 1', async () => {
      process.env.DEBUG_VLLM_CHAT_COMPLETION = '1';
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
      delete process.env.DEBUG_VLLM_CHAT_COMPLETION;
    });
  });
});
