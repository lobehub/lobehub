// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { VLLMModelCard } from './index';
import { LobeVLLMAI } from './index';

testProvider({
  Runtime: LobeVLLMAI,
  provider: ModelProvider.VLLM,
  defaultBaseURL: 'http://localhost:8000/v1',
  chatDebugEnv: 'DEBUG_VLLM_CHAT_COMPLETION',
  chatModel: 'llama-2-7b-chat',
});

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
});
