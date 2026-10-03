// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeFlexAI, params } from './index';

testProvider({
  Runtime: LobeFlexAI,
  chatDebugEnv: 'DEBUG_FLEXAI_CHAT_COMPLETION',
  chatModel: 'Llama-3.3-70B-Instruct-FP8',
  defaultBaseURL: 'https://api.flex.ai/v1',
  provider: ModelProvider.FlexAI,
});

/**
 * Rows trimmed from a real `GET https://api.flex.ai/v1/models` response
 * (2026-10-03). The four non-chat rows are the ones the type resolver has to
 * separate from the chat models; `PaddleOCR-VL` is the case a `category`-only
 * rule gets wrong.
 */
const modelsResponse = {
  data: [
    {
      category: 'text',
      context_length: 131_072,
      id: 'Llama-3.3-70B-Instruct-FP8',
      name: 'Llama 3.3 70B Instruct',
      pricing: { cached_input_per_mtok: 0.0203, input_per_mtok: 0.135, output_per_mtok: 0.4 },
      supports: ['chat', 'completion', 'streaming', 'tool_use'],
    },
    {
      category: 'vision',
      context_length: 262_144,
      id: 'gemma-4-31b-it',
      name: 'Gemma 4 31B IT',
      pricing: { input_per_mtok: 0.1, output_per_mtok: 0.34 },
      supports: ['chat', 'streaming', 'tool_use', 'vision'],
    },
    {
      category: 'text',
      context_length: 131_072,
      id: 'Mistral-Nemo-Instruct-2407-FP8',
      name: 'Mistral Nemo 12B',
      pricing: { input_per_mtok: 0.019, output_per_mtok: 0.03 },
      supports: ['chat', 'streaming'],
    },
    {
      category: 'vision',
      context_length: 131_072,
      id: 'PaddleOCR-VL',
      name: 'PaddleOCR-VL 0.9B',
      pricing: { input_per_mtok: 0.14, output_per_mtok: 0.8 },
      supports: ['image_input'],
    },
    {
      category: 'embedding',
      context_length: 8192,
      id: 'bge-m3',
      name: 'BGE-M3',
      pricing: { input_per_mtok: 0.01 },
      supports: ['embeddings'],
    },
    {
      category: 'image',
      id: 'FLUX.1-schnell',
      name: 'FLUX.1 Schnell',
      supports: ['image_generation'],
    },
    { category: 'audio', id: 'Kokoro-82M', name: 'Kokoro-82M', supports: ['audio_speech'] },
    {
      category: 'audio',
      id: 'whisper-large-v3-turbo',
      name: 'Whisper Large V3 Turbo',
      supports: ['audio_transcription'],
    },
  ],
};

const fetchModels = async (data: unknown[] = modelsResponse.data) => {
  const client = { models: { list: vi.fn().mockResolvedValue({ data }) } };
  return params.models!({ client: client as any });
};

describe('LobeFlexAI params', () => {
  it('exports the provider id and hosted base URL', () => {
    expect(params.provider).toBe(ModelProvider.FlexAI);
    expect(params.baseURL).toBe('https://api.flex.ai/v1');
  });

  it('gates chat debug output on DEBUG_FLEXAI_CHAT_COMPLETION', () => {
    delete process.env.DEBUG_FLEXAI_CHAT_COMPLETION;
    expect(params.debug?.chatCompletion()).toBe(false);

    process.env.DEBUG_FLEXAI_CHAT_COMPLETION = '1';
    expect(params.debug?.chatCompletion()).toBe(true);
    delete process.env.DEBUG_FLEXAI_CHAT_COMPLETION;
  });
});

describe('LobeFlexAI model list', () => {
  it('maps a chat row onto the catalogue metadata the response carries', async () => {
    const models = await fetchModels();
    const llama = models.find((model) => model.id === 'Llama-3.3-70B-Instruct-FP8');

    expect(llama).toMatchObject({
      contextWindowTokens: 131_072,
      displayName: 'Llama 3.3 70B Instruct',
      functionCall: true,
      type: 'chat',
      vision: false,
    });
    expect(llama?.pricing?.units).toEqual(
      expect.arrayContaining([
        { name: 'textInput', rate: 0.135, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0203, strategy: 'fixed', unit: 'millionTokens' },
      ]),
    );
  });

  it('reads vision and tool support from `supports`, not from the model name', async () => {
    const models = await fetchModels();

    expect(models.find((model) => model.id === 'gemma-4-31b-it')).toMatchObject({
      functionCall: true,
      vision: true,
    });
    // Mistral Nemo is served without tool support; the name must not imply it
    expect(models.find((model) => model.id === 'Mistral-Nemo-Instruct-2407-FP8')).toMatchObject({
      functionCall: false,
      vision: false,
    });
  });

  it('types the non-chat endpoints', async () => {
    const models = await fetchModels();
    const typeOf = (id: string) => models.find((model) => model.id === id)?.type;

    expect(typeOf('bge-m3')).toBe('embedding');
    expect(typeOf('Kokoro-82M')).toBe('tts');
    expect(typeOf('whisper-large-v3-turbo')).toBe('asr');
  });

  it('leaves image-generation rows out until they carry a parameter schema', async () => {
    const models = await fetchModels();

    expect(models.find((model) => model.id === 'FLUX.1-schnell')).toBeUndefined();
  });

  it('drops a row whose category claims vision but which serves no chat endpoint', async () => {
    const models = await fetchModels();

    expect(models.find((model) => model.id === 'PaddleOCR-VL')).toBeUndefined();
  });

  it('drops a row with no recognised endpoint and tolerates an empty catalogue', async () => {
    await expect(
      fetchModels([{ id: 'future-endpoint', supports: ['telepathy'] }]),
    ).resolves.toEqual([]);
    await expect(fetchModels([])).resolves.toEqual([]);
  });
});
