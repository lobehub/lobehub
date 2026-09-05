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

    expect(models).toHaveLength(5);
    expect(
      models.every((model) => model.settings?.extendParams?.includes('preserveThinking')),
    ).toBe(true);
  });
});

describe('OpenAI audio models', () => {
  it('advertises native audio support for gpt-audio', () => {
    const gptAudio = LOBE_DEFAULT_MODEL_LIST.find(
      (model) => model.providerId === ModelProvider.OpenAI && model.id === 'gpt-audio',
    );

    expect(gptAudio?.abilities.audio).toBe(true);
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

describe('MiniMax video models', () => {
  it('registers MiniMax-H3 with the official v2 parameter limits', () => {
    const h3 = LOBE_DEFAULT_MODEL_LIST.find(
      (model) => model.providerId === ModelProvider.Minimax && model.id === 'MiniMax-H3',
    );

    expect(h3).toEqual(
      expect.objectContaining({
        enabled: true,
        parameters: expect.objectContaining({
          aspectRatio: expect.objectContaining({ default: '16:9' }),
          duration: expect.objectContaining({ max: 15, min: 4 }),
          imageUrls: expect.objectContaining({ maxCount: 7 }),
          resolution: expect.objectContaining({ default: '768P', enum: ['768P', '2K'] }),
        }),
        releasedAt: '2026-07-31',
        type: 'video',
      }),
    );
  });

  it('keeps the combined MiniMax-H3 reference capacity within the v2 limit of 9', () => {
    const h3 = LOBE_DEFAULT_MODEL_LIST.find(
      (model) => model.providerId === ModelProvider.Minimax && model.id === 'MiniMax-H3',
    );

    const parameters = (h3?.parameters ?? {}) as {
      endImageUrl?: unknown;
      imageUrl?: unknown;
      imageUrls?: { maxCount?: number };
    };

    // The first-frame (imageUrl), reference-list (imageUrls), and last-frame
    // (endImageUrl) slots all normalize into a single reference pool that the
    // runtime caps at 9. The combined upload capacity must stay within that
    // limit so the UI can never assemble a payload createVideo would reject.
    const firstFrameSlots = parameters.imageUrl === undefined ? 0 : 1;
    const lastFrameSlots = parameters.endImageUrl === undefined ? 0 : 1;
    const referenceSlots = parameters.imageUrls?.maxCount ?? 0;

    expect(firstFrameSlots + referenceSlots + lastFrameSlots).toBeLessThanOrEqual(9);
  });
});

describe('Google rolling model aliases', () => {
  it('tracks the current Flash and Flash-Lite model versions', () => {
    const googleModels = LOBE_DEFAULT_MODEL_LIST.filter((model) => model.providerId === 'google');
    const flashLatest = googleModels.find((model) => model.id === 'gemini-flash-latest');
    const flash = googleModels.find((model) => model.id === 'gemini-3.8-flash');
    const flashLiteLatest = googleModels.find((model) => model.id === 'gemini-flash-lite-latest');
    const flashLite = googleModels.find((model) => model.id === 'gemini-3.5-flash-lite');

    expect(flashLatest).toEqual(
      expect.objectContaining({
        description: 'Points to gemini-3.8-flash',
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

describe('Google Gemini 3.1 Flash Image models', () => {
  it('registers stable IDs without removing the preview compatibility cards', () => {
    const googleModels = LOBE_DEFAULT_MODEL_LIST.filter(
      (model) => model.providerId === ModelProvider.Google,
    );
    const stableImageModel = googleModels.find(
      (model) => model.id === 'gemini-3.1-flash-image:image',
    );

    expect(googleModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          id: 'gemini-3.1-flash-image',
          releasedAt: '2026-05-28',
          type: 'chat',
        }),
        expect.objectContaining({
          enabled: true,
          id: 'gemini-3.1-flash-image:image',
          releasedAt: '2026-05-28',
          type: 'image',
        }),
        expect.objectContaining({
          enabled: false,
          id: 'gemini-3.1-flash-image-preview',
          releasedAt: '2026-02-26',
          type: 'chat',
        }),
        expect.objectContaining({
          enabled: false,
          id: 'gemini-3.1-flash-image-preview:image',
          releasedAt: '2026-02-26',
          type: 'image',
        }),
      ]),
    );
    expect(stableImageModel?.pricing?.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'textInput', rate: 0.5 }),
        expect.objectContaining({ name: 'imageInput', rate: 0.5 }),
        expect.objectContaining({ name: 'textOutput', rate: 3 }),
        expect.objectContaining({ name: 'imageOutput', rate: 60 }),
      ]),
    );
  });
});

describe('vendor provider cards', () => {
  it('advertises native search, image and video input for GLM-5.3-Flash', () => {
    // Without `video: true` the chat pipeline falls back to media analysis instead of sending
    // video to the model natively, even though the official card lists video input.
    const glm53Flash = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'zhipu' && m.id === 'glm-5.3-flash',
    );

    expect(glm53Flash?.abilities).toEqual(
      expect.objectContaining({ reasoning: true, search: true, video: true, vision: true }),
    );
    expect(glm53Flash?.settings?.searchImpl).toBe('params');
  });
});

describe('recent direct-provider models', () => {
  it.each(['qwen3.8-max', 'qwen3.8-max-0902'])(
    'exposes exactly one %s card with effort and thinking preservation controls',
    (id) => {
      const models = LOBE_DEFAULT_MODEL_LIST.filter(
        (entry) => entry.providerId === 'qwen' && entry.id === id,
      );
      expect(models).toHaveLength(1);
      expect(models[0].settings?.extendParams).toEqual([
        'qwen38ReasoningEffort',
        'preserveThinking',
      ]);
    },
  );

  it.each([
    ['openai', 'gpt-6-astra', 'gpt6ReasoningEffort'],
    ['google', 'gemini-3.8-flash', 'thinkingLevel3'],
    ['vertexai', 'gemini-3.8-flash', 'thinkingLevel3'],
    ['xai', 'grok-4.6', 'grok4_6ReasoningEffort'],
    ['qwen', 'qwen3.8-max', 'qwen38ReasoningEffort'],
    ['qwen', 'qwen3.8-max-0902', 'qwen38ReasoningEffort'],
  ])('exposes %s/%s with its reasoning controls', (providerId, id, reasoningParam) => {
    const model = LOBE_DEFAULT_MODEL_LIST.find(
      (entry) => entry.providerId === providerId && entry.id === id,
    );

    expect(model).toMatchObject({
      abilities: { functionCall: true, reasoning: true, vision: true },
      enabled: true,
      type: 'chat',
    });
    expect(model?.settings?.extendParams).toContain(reasoningParam);
  });
});

describe('Gemini 3.8 introductory pricing', () => {
  it.each(['google', 'vertexai'])('uses the published output rate for %s', (providerId) => {
    const model = LOBE_DEFAULT_MODEL_LIST.find(
      (entry) => entry.providerId === providerId && entry.id === 'gemini-3.8-flash',
    );
    expect(model?.pricing?.units).toContainEqual({
      name: 'textOutput',
      rate: 3.75,
      strategy: 'fixed',
      unit: 'millionTokens',
    });
  });
});

describe('subscription model catalogs', () => {
  it.each([
    ['chatgpt', 'gpt-6-astra', 'gpt6ReasoningEffort'],
    ['supergrok', 'grok-4.6', 'grok4_6ReasoningEffort'],
  ])('exposes %s/%s without usage-based pricing', (providerId, id, reasoningParam) => {
    const model = LOBE_DEFAULT_MODEL_LIST.find(
      (entry) => entry.providerId === providerId && entry.id === id,
    );
    expect(model).toMatchObject({ enabled: true, type: 'chat' });
    expect(model?.pricing).toBeUndefined();
    expect(model?.settings?.extendParams).toContain(reasoningParam);
  });

  it('keeps the ChatGPT context cap and thinking preservation', () => {
    const model = LOBE_DEFAULT_MODEL_LIST.find(
      (entry) => entry.providerId === 'chatgpt' && entry.id === 'gpt-6-astra',
    );
    expect(model?.contextWindowTokens).toBe(272_000);
    expect(model?.settings?.extendParams).toContain('preserveThinking');
  });
});
