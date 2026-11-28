// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeGMICloudAI, params } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

testProvider({
  Runtime: LobeGMICloudAI,
  provider: ModelProvider.GMICloud,
  defaultBaseURL: 'https://api.gmi-serving.com/v1',
  chatDebugEnv: 'DEBUG_GMICLOUD_CHAT_COMPLETION',
  chatModel: 'deepseek-ai/DeepSeek-V4-Flash',
  test: {
    skipAPICall: true,
  },
});

describe('LobeGMICloudAI models', () => {
  it('maps context length and per-token pricing', async () => {
    const client = {
      models: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              context_length: 262_144,
              id: 'acme/test-model',
              pricing: {
                completion: '0.000006000',
                input_cache_read: '0.000000250',
                input_cache_write: '0',
                prompt: '0.000002000',
              },
            },
          ],
        }),
      },
    };

    const [model] = await params.models({ client: client as any });

    expect(model.id).toBe('acme/test-model');
    expect(model.contextWindowTokens).toBe(262_144);
    expect(model.pricing).toEqual({
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    });
  });
});
