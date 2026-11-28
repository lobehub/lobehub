// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeMartLLMAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeMartLLMAI,
  chatDebugEnv: 'DEBUG_MARTLLM_CHAT_COMPLETION',
  chatModel: 'deepseek/deepseek-v3.2',
  defaultBaseURL: 'https://api.martllm.com/v1',
  provider: ModelProvider.MartLLM,
  test: {
    skipAPICall: true,
  },
});

describe('LobeMartLLMAI - models', () => {
  const listModels = (data: any) =>
    params.models({ client: { models: { list: vi.fn().mockResolvedValue({ data }) } } } as any);

  it('passes on the limits and abilities MartLLM reports', async () => {
    const models = await listModels([
      {
        context_length: 128_000,
        display_name: 'GPT-4o Mini',
        id: 'deepseek/deepseek-v3.2',
        max_output_tokens: 16_384,
        supports_reasoning: false,
        supports_tools: true,
        supports_vision: true,
      },
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      contextWindowTokens: 128_000,
      displayName: 'GPT-4o Mini',
      functionCall: true,
      id: 'deepseek/deepseek-v3.2',
      maxOutput: 16_384,
      reasoning: false,
      vision: true,
    });
  });

  it('keeps a model that reports only an id', async () => {
    const models = await listModels([{ id: 'some-seller/some-model' }]);

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('some-seller/some-model');
  });

  it('returns an empty list when the response has no data', async () => {
    await expect(listModels(undefined)).resolves.toEqual([]);
  });
});
