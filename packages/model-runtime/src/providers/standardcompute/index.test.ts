// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeStandardComputeAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeStandardComputeAI,
  provider: ModelProvider.StandardCompute,
  defaultBaseURL: 'https://api.stdcmpt.com/v1',
  chatDebugEnv: 'DEBUG_STANDARDCOMPUTE_CHAT_COMPLETION',
  chatModel: 'StandardCompute',
  test: {
    skipAPICall: true,
  },
});

const loadModels = async (data: any[]) => {
  const client = { models: { list: vi.fn().mockResolvedValue({ data, object: 'list' }) } };

  return params.models!({ client } as any);
};

describe('LobeStandardComputeAI - models', () => {
  it('keeps the ids the gateway serves, including the routed model', async () => {
    const cards = await loadModels([
      { id: 'StandardCompute', object: 'model' },
      { id: 'anthropic/claude-opus-5.5', object: 'model' },
      { id: 'openai/gpt-5.6-sol:eu', object: 'model' },
    ]);

    expect(cards.map((c) => c.id)).toEqual([
      'StandardCompute',
      'anthropic/claude-opus-5.5',
      'openai/gpt-5.6-sol:eu',
    ]);
  });

  it('maps context length, display name and capabilities from the gateway metadata', async () => {
    const [card] = await loadModels([
      {
        architecture: { input_modalities: ['text', 'image', 'video'], output_modalities: ['text'] },
        context_length: 1_048_576,
        display_name: 'Qwen 3.7 Flash',
        id: 'qwen/qwen3.7-flash',
        object: 'model',
        supported_parameters: ['tools', 'tool_choice', 'reasoning', 'reasoning_effort'],
      },
    ]);

    expect(card).toMatchObject({
      contextWindowTokens: 1_048_576,
      displayName: 'Qwen 3.7 Flash',
      functionCall: true,
      id: 'qwen/qwen3.7-flash',
      reasoning: true,
      video: true,
      vision: true,
    });
  });

  it('marks a text-only model without tools or reasoning as such', async () => {
    const [card] = await loadModels([
      {
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        context_length: 128_000,
        id: 'someone/text-model',
        object: 'model',
        supported_parameters: ['response_format'],
      },
    ]);

    expect(card).toMatchObject({
      functionCall: false,
      reasoning: false,
      video: false,
      vision: false,
    });
  });

  it('leaves pricing unset, since the gateway publishes no per-model prices', async () => {
    const [card] = await loadModels([
      { context_length: 1_000_000, id: 'StandardCompute', object: 'model' },
    ]);

    expect(card.pricing).toBeUndefined();
  });

  it('returns an empty list when the gateway serves no models', async () => {
    expect(await loadModels([])).toEqual([]);
  });
});
