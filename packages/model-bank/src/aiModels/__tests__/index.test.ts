import { describe, expect, it, vi } from 'vitest';

import { ModelProvider } from '../../const/modelProvider';
import { loadModels, LOBE_DEFAULT_MODEL_LIST } from '../index';

describe('loadModels', () => {
  it('returns the static model list by default', async () => {
    await expect(loadModels()).resolves.toBe(LOBE_DEFAULT_MODEL_LIST);
  });

  it('overrides provider models with injected async loaders', async () => {
    const loader = vi.fn().mockResolvedValue([
      {
        enabled: true,
        id: 'injected-lobehub-model',
        type: 'chat',
      },
    ]);

    const models = await loadModels({
      providerLoaders: {
        [ModelProvider.LobeHub]: loader,
      },
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          id: 'injected-lobehub-model',
          providerId: ModelProvider.LobeHub,
          source: 'builtin',
          type: 'chat',
        }),
      ]),
    );
  });

  it('ignores undefined provider loaders', async () => {
    await expect(
      loadModels({
        providerLoaders: {
          [ModelProvider.LobeHub]: undefined,
        },
      }),
    ).resolves.toBe(LOBE_DEFAULT_MODEL_LIST);
  });

  it('propagates injected loader errors without falling back to static models', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('model config missing'));

    await expect(
      loadModels({
        providerLoaders: {
          [ModelProvider.LobeHub]: loader,
        },
      }),
    ).rejects.toThrow('model config missing');
  });
});

describe('knowledgeCutoff backfill', () => {
  it('fills knowledgeCutoff from the canonical map for builtin models', () => {
    const fable = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'anthropic' && m.id === 'claude-fable-5',
    );
    expect(fable?.knowledgeCutoff).toBe('2026-01');

    const opus = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'anthropic' && m.id === 'claude-opus-4-8',
    );
    expect(opus?.knowledgeCutoff).toBe('2026-01');

    // aggregator spelling of the same model gets the same cutoff
    const bedrockOpus = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'bedrock' && m.id === 'global.anthropic.claude-opus-4-7',
    );
    expect(bedrockOpus?.knowledgeCutoff).toBe('2026-01');

    const vertexGemini3Pro = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'vertexai' && m.id === 'gemini-3-pro-preview',
    );
    expect(vertexGemini3Pro?.knowledgeCutoff).toBe('2025-01');
  });

  it('keeps an explicit knowledgeCutoff over the map value', async () => {
    const loader = vi.fn().mockResolvedValue([
      { enabled: true, id: 'gpt-5', knowledgeCutoff: '2020-01', type: 'chat' },
      { enabled: true, id: 'gpt-5-mini', type: 'chat' },
    ]);

    const models = await loadModels({
      providerLoaders: { [ModelProvider.LobeHub]: loader },
    });

    const lobehubModels = models.filter((m) => m.providerId === ModelProvider.LobeHub);
    expect(lobehubModels.find((m) => m.id === 'gpt-5')?.knowledgeCutoff).toBe('2020-01');
    expect(lobehubModels.find((m) => m.id === 'gpt-5-mini')?.knowledgeCutoff).toBe('2024-05');
  });
});

describe('ChatGPT subscription models', () => {
  it('advertises reasoning replay support', () => {
    const models = LOBE_DEFAULT_MODEL_LIST.filter(
      (model) => model.providerId === ModelProvider.ChatGPT,
    );

    expect(models).toHaveLength(4);
    expect(
      models.every((model) => model.settings?.extendParams?.includes('preserveThinking')),
    ).toBe(true);
  });
});

describe('Moonshot models', () => {
  it('advertises Kimi K3 reasoning effort controls', () => {
    const kimiK3 = LOBE_DEFAULT_MODEL_LIST.find(
      (model) => model.providerId === ModelProvider.Moonshot && model.id === 'kimi-k3',
    );

    expect(kimiK3?.settings?.extendParams).toContain('kimiK3ReasoningEffort');
  });
});

describe('Hunyuan models', () => {
  it('registers Hy3 with agent capabilities', () => {
    const hy3 = LOBE_DEFAULT_MODEL_LIST.find(
      (model) => model.providerId === ModelProvider.Hunyuan && model.id === 'hy3',
    );

    expect(hy3).toEqual(
      expect.objectContaining({
        abilities: expect.objectContaining({
          functionCall: true,
          reasoning: true,
          structuredOutput: true,
        }),
        contextWindowTokens: 256_000,
        enabled: true,
        maxOutput: 128_000,
        settings: {
          extendParams: ['hy3ReasoningEffort'],
        },
        type: 'chat',
      }),
    );
  });
});

describe('Google rolling model aliases', () => {
  it('tracks the current Flash and Flash-Lite model versions', () => {
    const googleModels = LOBE_DEFAULT_MODEL_LIST.filter((model) => model.providerId === 'google');
    const flashLatest = googleModels.find((model) => model.id === 'gemini-flash-latest');
    const flash = googleModels.find((model) => model.id === 'gemini-3.6-flash');
    const flashLiteLatest = googleModels.find((model) => model.id === 'gemini-flash-lite-latest');
    const flashLite = googleModels.find((model) => model.id === 'gemini-3.5-flash-lite');

    expect(flashLatest).toEqual(
      expect.objectContaining({
        description: 'Points to gemini-3.6-flash',
        knowledgeCutoff: '2026-03',
      }),
    );
    expect(flashLatest?.pricing).toEqual(flash?.pricing);
    expect(flashLatest?.settings?.disabledParams).toEqual(['temperature', 'top_p']);

    expect(flashLiteLatest).toEqual(
      expect.objectContaining({
        description: 'Points to gemini-3.5-flash-lite',
        knowledgeCutoff: '2026-03',
      }),
    );
    expect(flashLiteLatest?.pricing).toEqual(flashLite?.pricing);
    expect(flashLiteLatest?.settings?.disabledParams).toEqual(['temperature', 'top_p']);
  });
});

describe('latest provider model cards', () => {
  it('registers GLM-5.2 for the first-party Zhipu provider', () => {
    const model = LOBE_DEFAULT_MODEL_LIST.find(
      (item) => item.providerId === ModelProvider.ZhiPu && item.id === 'glm-5.2',
    );

    expect(model).toEqual(
      expect.objectContaining({
        abilities: expect.objectContaining({ functionCall: true, reasoning: true }),
        contextWindowTokens: 1_000_000,
        maxOutput: 131_072,
        settings: expect.objectContaining({
          extendParams: ['enableReasoning', 'glm5_2ReasoningEffort'],
        }),
      }),
    );
  });

  it('uses the stable Gemini image model ids for Google', () => {
    const googleModels = LOBE_DEFAULT_MODEL_LIST.filter(
      (model) => model.providerId === ModelProvider.Google,
    );

    expect(googleModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gemini-3.1-flash-image', type: 'chat' }),
        expect.objectContaining({ id: 'gemini-3.1-flash-image:image', type: 'image' }),
        expect.objectContaining({ id: 'gemini-3-pro-image', type: 'chat' }),
        expect.objectContaining({ id: 'gemini-3-pro-image:image', type: 'image' }),
      ]),
    );
    expect(
      googleModels.some((model) =>
        [
          'gemini-3.1-flash-image-preview',
          'gemini-3.1-flash-image-preview:image',
          'gemini-3-pro-image-preview',
          'gemini-3-pro-image-preview:image',
        ].includes(model.id),
      ),
    ).toBe(false);
  });

  it('registers the latest OpenAI transcription and realtime models', () => {
    const openaiModels = LOBE_DEFAULT_MODEL_LIST.filter(
      (model) => model.providerId === ModelProvider.OpenAI,
    );

    expect(openaiModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-transcribe', type: 'asr' }),
        expect.objectContaining({
          contextWindowTokens: 128_000,
          id: 'gpt-realtime-2.1',
          maxOutput: 32_000,
          type: 'realtime',
        }),
        expect.objectContaining({
          contextWindowTokens: 128_000,
          id: 'gpt-realtime-2.1-mini',
          maxOutput: 32_000,
          type: 'realtime',
        }),
      ]),
    );
  });
});
