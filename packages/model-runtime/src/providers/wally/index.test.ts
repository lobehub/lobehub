// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeWallyAI, params } from './index';

const provider = ModelProvider.Wally;
const defaultBaseURL = 'https://inference.runanywhere.ai/v1';

testProvider({
  Runtime: LobeWallyAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_WALLY_CHAT_COMPLETION',
  chatModel: 'deepseek-v4.1-flash',
  test: {
    skipAPICall: true,
  },
});

describe('LobeWallyAI - models', () => {
  const mockClient = (data: any[]) => ({
    models: { list: vi.fn().mockResolvedValue({ data }) },
  });

  it('should map the Wally model list fields onto model cards', async () => {
    const client = mockClient([
      {
        context_length: 1_048_576,
        description: 'DeepSeek V4.1 Flash with a 1,048,576-token context window.',
        id: 'deepseek-v4.1-flash',
        input_modalities: ['text', 'image'],
        max_output_tokens: 65_536,
        name: 'DeepSeek V4.1 Flash',
        pricing: {
          completion: '0.0000012',
          input_cache_read: '0.000000006',
          prompt: '0.000000275',
        },
        supported_features: ['tools', 'json_mode', 'structured_outputs', 'reasoning'],
      },
      {
        context_length: 524_287,
        id: 'minimax-m3',
        input_modalities: ['text'],
        max_output_tokens: 131_072,
        name: 'MiniMax M3',
        pricing: { completion: '0.0000012', prompt: '0.0000003' },
        supported_features: ['json_mode'],
      },
    ]);

    const models = await params.models({ client: client as any });

    expect(client.models.list).toHaveBeenCalledTimes(1);

    const flash = models.find((m) => m.id === 'deepseek-v4.1-flash');
    expect(flash).toMatchObject({
      contextWindowTokens: 1_048_576,
      displayName: 'DeepSeek V4.1 Flash',
      enabled: true,
      functionCall: true,
      maxOutput: 65_536,
      reasoning: true,
      vision: true,
    });
    expect(flash?.pricing?.units).toEqual([
      { name: 'textInput', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
      { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      { name: 'textInput_cacheRead', rate: 0.006, strategy: 'fixed', unit: 'millionTokens' },
    ]);

    const minimax = models.find((m) => m.id === 'minimax-m3');
    expect(minimax).toMatchObject({
      contextWindowTokens: 524_287,
      functionCall: false,
      maxOutput: 131_072,
      reasoning: false,
      vision: false,
    });
    expect(minimax?.pricing?.units).toEqual([
      { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
    ]);
  });

  it('should fall back to model-bank data when the list carries only ids', async () => {
    const client = mockClient([{ id: 'glm-5.3-flash' }]);

    const models = await params.models({ client: client as any });

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      contextWindowTokens: 1_048_576,
      functionCall: true,
      id: 'glm-5.3-flash',
      maxOutput: 131_072,
      reasoning: true,
    });
  });

  it('should use the Wally card, not another provider card, for an id-only entry', async () => {
    const client = mockClient([{ id: 'minimax-m3' }, { id: 'kimi-k3' }]);

    const models = await params.models({ client: client as any });

    const minimax = models.find((m) => m.id === 'minimax-m3');
    expect(minimax).toMatchObject({
      contextWindowTokens: 524_287,
      maxOutput: 131_072,
      search: false,
      video: false,
      vision: false,
    });
    expect(minimax?.pricing?.units).toEqual(
      expect.arrayContaining([
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ]),
    );

    const kimi = models.find((m) => m.id === 'kimi-k3');
    expect(kimi).toMatchObject({ maxOutput: 65_536, vision: true });
  });

  it('should not add video or search to a text-only model', async () => {
    const client = mockClient([
      {
        id: 'glm-5.3-flash',
        input_modalities: ['text'],
        supported_features: ['tools', 'reasoning'],
      },
    ]);

    const models = await params.models({ client: client as any });

    expect(models[0]).toMatchObject({ search: false, video: false, vision: false });
  });

  it('should return an empty list when the response has no data', async () => {
    const client = { models: { list: vi.fn().mockResolvedValue({}) } };

    const models = await params.models({ client: client as any });

    expect(models).toEqual([]);
  });
});
