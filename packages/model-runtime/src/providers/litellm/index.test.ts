// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { LiteLLMModelCard } from './index';
import { LobeLiteLLMAI } from './index';

testProvider({
  Runtime: LobeLiteLLMAI,
  provider: ModelProvider.LiteLLM,
  defaultBaseURL: 'http://localhost:4000/v1',
  chatDebugEnv: 'DEBUG_LITELLM_CHAT_COMPLETION',
  chatModel: 'gemini-3.8-flash',
});

describe('LobeLiteLLMAI - custom features', () => {
  let instance: InstanceType<typeof LobeLiteLLMAI>;

  beforeEach(() => {
    instance = new LobeLiteLLMAI({ apiKey: 'test_api_key' });
  });

  describe('init', () => {
    it('should initialize without an API key for a proxy that has no auth', () => {
      const keyless = new LobeLiteLLMAI();

      expect(keyless).toBeInstanceOf(LobeLiteLLMAI);
      expect(keyless.baseURL).toEqual('http://localhost:4000/v1');
    });

    it('should use a custom proxy URL', () => {
      const custom = new LobeLiteLLMAI({
        apiKey: 'sk-test',
        baseURL: 'https://litellm.example.com/v1',
      });

      expect(custom.baseURL).toEqual('https://litellm.example.com/v1');
    });
  });

  describe('models', () => {
    it('should fetch and process model list correctly', async () => {
      const mockModelList: LiteLLMModelCard[] = [
        { id: 'gpt-6-luna' },
        { id: 'text-embedding-3-large' },
        { id: 'my-internal-alias' },
      ];

      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({
        data: mockModelList,
      } as any);

      const models = await instance.models();

      expect(instance['client'].models.list).toHaveBeenCalled();
      expect(models).toHaveLength(3);
      expect(models[0]).toMatchObject({ id: 'gpt-6-luna', type: 'chat' });
      expect(models[1]).toMatchObject({ id: 'text-embedding-3-large', type: 'embedding' });
      expect(models[2]).toMatchObject({ id: 'my-internal-alias', type: 'chat' });
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
