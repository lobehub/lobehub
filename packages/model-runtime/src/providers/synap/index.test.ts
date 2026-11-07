// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('params', () => {
  it('registers as its own provider', () => {
    expect(params.provider).toBe(ModelProvider.Synap);
  });

  it('points at the public gateway', () => {
    expect(params.baseURL).toBe('https://synap.linkrra.com/v1');
  });

  it('turns debug output on only when asked', () => {
    delete process.env.DEBUG_SYNAP_CHAT_COMPLETION;
    expect(params.debug!.chatCompletion!()).toBe(false);

    process.env.DEBUG_SYNAP_CHAT_COMPLETION = '1';
    expect(params.debug!.chatCompletion!()).toBe(true);

    delete process.env.DEBUG_SYNAP_CHAT_COMPLETION;
  });
});

describe('the model list Synap serves', () => {
  const stubModels = (data: any[]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ data, object: 'list' }),
        ok: true,
      }),
    );
  };

  beforeEach(() => {
    stubModels([]);
  });

  it('fetches the public catalogue, no API key needed', async () => {
    await params.models();

    expect(fetch).toHaveBeenCalledWith('https://synap.linkrra.com/v1/models');
  });

  it('throws when the gateway does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(params.models()).rejects.toThrow(/503/);
  });

  it('reads the router models, which carry only pricing and a capability line', async () => {
    stubModels([
      {
        capability: 'Reasoning, deep',
        id: 'synap-v1-pro',
        object: 'model',
        owned_by: 'synap',
        pricing: { completion_per_million: 4.05, currency: 'USD', prompt_per_million: 2.28 },
      },
    ]);

    const models = await params.models();

    expect(models[0].id).toBe('synap-v1-pro');
    expect(models[0].pricing).toEqual({
      units: [
        { name: 'textInput', rate: 2.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    });
    // A router card has no modality breakdown, so these stay unset rather than false.
    expect(models[0].contextWindowTokens).toBeUndefined();
  });

  it('reads context window and output limit from the fleet models’ modality breakdown', async () => {
    stubModels([
      {
        context_note: 'Fast + cheap general model',
        id: 'gpt-oss-20b',
        input_modalities: [
          {
            supported_inputs: { max_context_length: { unit: 'token', value: 131_072 } },
            type: 'text',
          },
        ],
        name: 'OpenAI: gpt-oss-20b',
        object: 'model',
        output_modalities: [
          {
            max_length: { unit: 'token', value: 131_072 },
            supported_parameters: { tools: { type: 'boolean' } },
            type: 'text',
          },
        ],
        owned_by: 'pearlpool-fleet',
        pricing: { completion_per_million: 0.085, currency: 'USD', prompt_per_million: 0.017 },
      },
    ]);

    const models = await params.models();

    expect(models[0].contextWindowTokens).toBe(131_072);
    expect(models[0].maxOutput).toBe(131_072);
    expect(models[0].functionCall).toBe(true);
    expect(models[0].description).toBe('Fast + cheap general model');
  });

  it('reads vision from an input modality of type image', async () => {
    stubModels([
      {
        id: 'qwen/qwen3-vl-30b-a3b-instruct',
        input_modalities: [{ type: 'text' }, { type: 'image' }],
        object: 'model',
        owned_by: 'pearlpool-fleet',
      },
    ]);

    const models = await params.models();

    expect(models[0].vision).toBe(true);
  });

  it('leaves tool calls unset when the model lists no output modality at all', async () => {
    stubModels([{ id: 'synap-v1', object: 'model', owned_by: 'synap' }]);

    const models = await params.models();

    expect(models[0].functionCall).toBe(false);
  });

  it('reads the release date off the fleet models’ created timestamp', async () => {
    stubModels([{ created: 1_791_849_600, id: 'gpt-oss-20b', object: 'model' }]);

    const models = await params.models();

    expect(models[0].releasedAt).toBe('2026-10-13');
  });
});
