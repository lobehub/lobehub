import type { Pricing, PricingUnit, VideoModelParamsSchema } from 'model-bank';
import { CHAT_MODEL_IMAGE_GENERATION_PARAMS, DEFAULT_VIDEO_GENERATION_PARAMS } from 'model-bank';

import { processMultiProviderModelList } from '../../utils/modelParse';
import { postProcessModelList } from '../../utils/postProcessModelList';
import type { OpenRouterModelCard, OpenRouterVideoModelCard } from './type';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_VIDEO_MODELS_URL = 'https://openrouter.ai/api/v1/videos/models';

const formatPrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return undefined;
  return Number((numericPrice * 1e6).toPrecision(5));
};

const parsePrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  const numericPrice = Number(price);
  return Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : undefined;
};

const fixedUnit = (
  name: PricingUnit['name'],
  rate: number | undefined,
  unit: PricingUnit['unit'],
): PricingUnit | undefined =>
  typeof rate === 'number' ? { name, rate, strategy: 'fixed', unit } : undefined;

const compactUnits = (units: Array<PricingUnit | undefined>): PricingUnit[] =>
  units.filter((unit): unit is PricingUnit => !!unit);

const mergePricing = (base?: Pricing, generation?: Pricing): Pricing | undefined => {
  if (!base) return generation;
  if (!generation) return base;

  const generationUnitNames = new Set(generation.units.map((unit) => unit.name));
  return {
    approximatePricePerImage: generation.approximatePricePerImage ?? base.approximatePricePerImage,
    approximatePricePerVideo: generation.approximatePricePerVideo ?? base.approximatePricePerVideo,
    currency: generation.currency ?? base.currency,
    units: [
      ...base.units.filter((unit) => !generationUnitNames.has(unit.name)),
      ...generation.units,
    ],
  };
};

const mapOpenRouterPricing = (
  pricing: OpenRouterModelCard['pricing'],
  outputModalities: readonly string[],
): Pricing | undefined => {
  const hasAssetOutput = outputModalities.includes('image') || outputModalities.includes('video');
  const input = formatPrice(pricing.prompt);
  const output = formatPrice(pricing.completion);
  const cachedInput = formatPrice(pricing.input_cache_read);
  const writeCacheInput = formatPrice(pricing.input_cache_write);
  const imageInput = parsePrice(pricing.image);
  const imageOutput = formatPrice(pricing.image_output);
  const videoOutput = formatPrice(pricing.video_output ?? pricing.video_token);

  const units = compactUnits([
    fixedUnit('textInput', input === 0 && hasAssetOutput ? undefined : input, 'millionTokens'),
    fixedUnit('textOutput', output === 0 && hasAssetOutput ? undefined : output, 'millionTokens'),
    fixedUnit('textInput_cacheRead', cachedInput, 'millionTokens'),
    fixedUnit('textInput_cacheWrite', writeCacheInput, 'millionTokens'),
    fixedUnit('imageInput', imageInput, 'image'),
    fixedUnit('imageGeneration', imageOutput, 'millionTokens'),
    fixedUnit('videoGeneration', videoOutput, 'millionTokens'),
  ]);

  if (units.length === 0) return undefined;
  return { currency: 'USD', units };
};

const getDefaultVideoDuration = (durations: number[] | null): number => {
  if (!durations?.length) return DEFAULT_VIDEO_GENERATION_PARAMS.duration.default;
  if (durations.includes(DEFAULT_VIDEO_GENERATION_PARAMS.duration.default)) {
    return DEFAULT_VIDEO_GENERATION_PARAMS.duration.default;
  }
  return [...durations].sort((a, b) => a - b)[0];
};

const getDefaultVideoResolution = (resolutions: string[] | null): string | undefined => {
  if (!resolutions?.length) return DEFAULT_VIDEO_GENERATION_PARAMS.resolution.default;
  if (resolutions.includes(DEFAULT_VIDEO_GENERATION_PARAMS.resolution.default)) {
    return DEFAULT_VIDEO_GENERATION_PARAMS.resolution.default;
  }
  return resolutions[0];
};

const scoreVideoSecondSku = (
  key: string,
  model: OpenRouterVideoModelCard,
  defaultResolution: string | undefined,
) => {
  const normalizedKey = key.toLowerCase().replaceAll('-', '_');
  let score = 0;

  if (
    normalizedKey === 'duration_seconds' ||
    normalizedKey === 'cents_per_second_output' ||
    normalizedKey === 'per_video_second'
  ) {
    score += 5;
  }

  if (model.generate_audio === true) {
    if (normalizedKey.includes('with_audio')) score += 20;
    if (normalizedKey.includes('without_audio')) score -= 20;
  } else if (model.generate_audio === false) {
    if (normalizedKey.includes('without_audio')) score += 20;
    if (normalizedKey.includes('with_audio')) score -= 20;
  }

  const resolutionMatches = normalizedKey.match(/(?:^|_)(\d{3,4}p|[124]k)(?:_|$)/g) ?? [];
  if (defaultResolution) {
    const normalizedResolution = defaultResolution.toLowerCase();
    if (normalizedKey.includes(normalizedResolution)) score += 10;
    else if (resolutionMatches.length > 0) score -= 10;
  }

  if (normalizedKey.includes('text_to_video')) score += 3;
  if (
    normalizedKey.includes('image_to_video') ||
    normalizedKey.includes('continuation') ||
    normalizedKey.includes('video_input')
  ) {
    score -= 10;
  }

  return score;
};

const isVideoSecondSku = (key: string) => {
  const normalizedKey = key.toLowerCase().replaceAll('-', '_');
  if (
    normalizedKey.includes('minimum') ||
    normalizedKey.includes('image_input') ||
    normalizedKey.includes('reference')
  ) {
    return false;
  }
  return normalizedKey.includes('duration_seconds') || normalizedKey.includes('second');
};

const priceFromVideoSecondSku = (key: string, value: string) => {
  const price = parsePrice(value);
  if (price === undefined) return undefined;
  return key.toLowerCase().replaceAll('-', '_').startsWith('cents_') ? price / 100 : price;
};

/** Convert OpenRouter's heterogeneous video SKUs into the unit shown by Create Video. */
export const resolveOpenRouterVideoPricing = (
  model: OpenRouterVideoModelCard,
): Pricing | undefined => {
  const entries = Object.entries(model.pricing_skus ?? {});
  const defaultResolution = getDefaultVideoResolution(model.supported_resolutions);
  const secondCandidates = entries
    .filter(([key]) => isVideoSecondSku(key))
    .map(([key, value]) => ({
      key,
      rate: priceFromVideoSecondSku(key, value),
      score: scoreVideoSecondSku(key, model, defaultResolution),
    }))
    .filter(
      (entry): entry is { key: string; rate: number; score: number } =>
        typeof entry.rate === 'number',
    )
    .sort((a, b) => b.score - a.score || a.rate - b.rate);

  const secondRate = secondCandidates[0]?.rate;
  if (typeof secondRate === 'number') {
    return {
      approximatePricePerVideo: secondRate * getDefaultVideoDuration(model.supported_durations),
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: secondRate, strategy: 'fixed', unit: 'second' }],
    };
  }

  const videoTokenEntry =
    entries.find(([key]) => key === 'video_tokens') ??
    entries.find(([key]) => key.startsWith('video_tokens'));
  const videoTokenRate = formatPrice(videoTokenEntry?.[1]);
  if (typeof videoTokenRate === 'number') {
    return {
      currency: 'USD',
      units: [
        {
          name: 'videoGeneration',
          rate: videoTokenRate,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    };
  }

  const flatVideoEntry = entries.find(([key]) =>
    ['generate', 'per_video', 'per-video'].includes(key.toLowerCase()),
  );
  const flatVideoRate = parsePrice(flatVideoEntry?.[1]);
  if (typeof flatVideoRate === 'number') {
    return {
      approximatePricePerVideo: flatVideoRate,
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: flatVideoRate, strategy: 'fixed', unit: 'video' }],
    };
  }

  const minimumGenerationEntry = entries.find(([key]) =>
    key.toLowerCase().includes('minimum_cents_per_generation'),
  );
  const minimumGenerationPrice = parsePrice(minimumGenerationEntry?.[1]);
  if (typeof minimumGenerationPrice === 'number') {
    return {
      approximatePricePerVideo: minimumGenerationPrice / 100,
      currency: 'USD',
      units: [],
    };
  }

  return undefined;
};

const resolveOpenRouterVideoParameters = (
  model?: OpenRouterVideoModelCard,
): VideoModelParamsSchema => {
  if (!model) return DEFAULT_VIDEO_GENERATION_PARAMS;

  const aspectRatios = model.supported_aspect_ratios;
  const resolutions = model.supported_resolutions;
  const durations = model.supported_durations;
  const defaultDuration = getDefaultVideoDuration(durations);

  return {
    ...DEFAULT_VIDEO_GENERATION_PARAMS,
    ...(aspectRatios?.length && {
      aspectRatio: {
        default: aspectRatios.includes('16:9') ? '16:9' : aspectRatios[0],
        enum: aspectRatios,
      },
    }),
    ...(resolutions?.length && {
      resolution: {
        default: getDefaultVideoResolution(resolutions)!,
        enum: resolutions,
      },
    }),
    ...(durations?.length && {
      duration: { default: defaultDuration, enum: [...durations].sort((a, b) => a - b) },
    }),
    ...(typeof model.generate_audio === 'boolean' && {
      generateAudio: { default: model.generate_audio },
    }),
  };
};

/**
 * Map exclusive (non-text) OpenRouter output modalities onto LobeHub model types.
 * Multimodal chat+image/audio stays `chat`; dedicated generators get a real type.
 */
export const typeFromOpenRouterOutputModalities = (
  outputModalities: readonly string[],
): 'image' | 'video' | 'text2music' | undefined => {
  const hasText = outputModalities.includes('text');
  if (hasText) return undefined;

  if (outputModalities.includes('video')) return 'video';
  if (outputModalities.includes('image')) return 'image';
  if (outputModalities.includes('audio')) return 'text2music';
  return undefined;
};

/**
 * Map a raw OpenRouter models API card into the flat fields consumed by
 * `processMultiProviderModelList`.
 */
export const mapOpenRouterModelCard = (
  model: OpenRouterModelCard,
  videoModel?: OpenRouterVideoModelCard,
) => {
  const { top_provider, architecture, pricing, supported_parameters } = model;

  const inputModalities = architecture.input_modalities || [];
  const outputModalities = architecture.output_modalities || [];
  const type = typeFromOpenRouterOutputModalities(outputModalities);

  // Process the name, by default strip the colon and everything before it
  let displayName = model.name;
  const colonIndex = displayName.indexOf(':');
  if (colonIndex !== -1) {
    const prefix = displayName.slice(0, Math.max(0, colonIndex)).trim();
    const suffix = displayName.slice(Math.max(0, colonIndex + 1)).trim();

    const isDeepSeekPrefix = prefix.toLowerCase() === 'deepseek';
    const suffixHasDeepSeek = suffix.toLowerCase().includes('deepseek');

    if (isDeepSeekPrefix && !suffixHasDeepSeek) {
      displayName = model.name;
    } else {
      displayName = suffix;
    }
  }

  const inputPrice = formatPrice(pricing.prompt);
  const outputPrice = formatPrice(pricing.completion);
  const cachedInputPrice = formatPrice(pricing.input_cache_read);
  const writeCacheInputPrice = formatPrice(pricing.input_cache_write);

  const hasReasoning = supported_parameters.includes('reasoning');
  const hasImageOutput = outputModalities.includes('image');
  // Always set type explicitly so processModelCard keyword heuristics
  // (e.g. `-image` → image → drop without parameters) cannot override
  // multimodal chat+image cards before we synthesize `:image` clones.
  const resolvedType = type ?? 'chat';

  // Zero text-token prices are normal for image/video SKUs billed per asset.
  // Do not stamp "(free)" onto generators — that hides them from Create pickers.
  const isChatFreeTier =
    resolvedType === 'chat' &&
    !hasImageOutput &&
    inputPrice === 0 &&
    outputPrice === 0 &&
    !displayName.endsWith('(free)');
  if (isChatFreeTier) {
    displayName += ' (free)';
  }

  return {
    contextWindowTokens: top_provider.context_length || model.context_length,
    description: model.description,
    displayName,
    // OpenRouter marks document/PDF-capable chat models with file in input_modalities.
    files: inputModalities.includes('file'),
    functionCall: supported_parameters.includes('tools'),
    // Multimodal image generators expose image in output_modalities (often with text).
    // Chat type stays; postProcessModelList adds `{id}:image` for the Image tab.
    imageOutput: hasImageOutput,
    id: model.id,
    maxOutput:
      typeof top_provider.max_completion_tokens === 'number'
        ? top_provider.max_completion_tokens
        : typeof model.context_length === 'number'
          ? model.context_length
          : undefined,
    // Pure image/video generators need parameters or processModelCard drops them.
    ...(resolvedType === 'image' ? { parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS } : {}),
    ...(resolvedType === 'video'
      ? { parameters: resolveOpenRouterVideoParameters(videoModel) }
      : {}),
    pricing: mergePricing(
      mapOpenRouterPricing(pricing, outputModalities),
      resolvedType === 'video' && videoModel
        ? resolveOpenRouterVideoPricing(videoModel)
        : undefined,
    ),
    reasoning: hasReasoning,
    releasedAt: new Date(model.created * 1000).toISOString().split('T')[0],
    type: resolvedType,
    // Video in input_modalities = can analyze video as input (chat ability),
    // not type:'video' generation.
    video: inputModalities.includes('video') || resolvedType === 'video',
    vision: inputModalities.includes('image'),
    // Merge all applicable extendParams for settings
    ...(() => {
      const extendParams: string[] = [];
      if (model.description && model.description.includes('`reasoning` `enabled`')) {
        extendParams.push('enableReasoning');
      }
      if (
        hasReasoning &&
        (model.id.includes('gpt-5.2') ||
          model.id.includes('gpt-5.4') ||
          model.id.includes('gpt-5.5'))
      ) {
        extendParams.push('gpt5_2ReasoningEffort', 'textVerbosity');
      } else if (hasReasoning && model.id.includes('gpt-5.1')) {
        extendParams.push('gpt5_1ReasoningEffort', 'textVerbosity');
      } else if (hasReasoning && model.id.includes('gpt-5')) {
        extendParams.push('gpt5ReasoningEffort', 'textVerbosity');
      } else if (hasReasoning && model.id.includes('openai')) {
        extendParams.push('reasoningEffort', 'textVerbosity');
      }
      if (hasReasoning && model.id.includes('claude')) {
        extendParams.push('enableReasoning', 'reasoningBudgetToken');
      }
      if (model.id.includes('claude') && writeCacheInputPrice && writeCacheInputPrice !== 0) {
        extendParams.push('disableContextCaching');
      }
      if (hasReasoning && model.id.includes('gemini-2.5')) {
        extendParams.push('reasoningBudgetToken');
      }
      if (hasReasoning && model.id.includes('gemini-3-pro')) {
        extendParams.push('thinkingLevel2');
      }
      if (hasReasoning && model.id.includes('gemini-3-flash')) {
        extendParams.push('thinkingLevel');
      }
      return extendParams.length > 0 ? { settings: { extendParams } } : {};
    })(),
  };
};

const fetchOpenRouterModelPage = async (outputModalities?: 'image' | 'video') => {
  const url = outputModalities
    ? `${OPENROUTER_MODELS_URL}?output_modalities=${outputModalities}`
    : OPENROUTER_MODELS_URL;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenRouter models API request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { data?: OpenRouterModelCard[] };
  return data.data ?? [];
};

const fetchOpenRouterVideoModelPage = async () => {
  const response = await fetch(OPENROUTER_VIDEO_MODELS_URL);
  if (!response.ok) {
    throw new Error(`OpenRouter video models API request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { data?: OpenRouterVideoModelCard[] };
  return data.data ?? [];
};

/** Later pages win so image/video modality metadata overwrites the text catalog stub. */
export const mergeOpenRouterModelPages = (
  pages: OpenRouterModelCard[][],
): OpenRouterModelCard[] => {
  const byId = new Map<string, OpenRouterModelCard>();
  for (const page of pages) {
    for (const model of page) {
      byId.set(model.id, model);
    }
  }
  return [...byId.values()];
};

/**
 * Fetch the live OpenRouter model catalog and normalize it for LobeHub.
 * Used by the OpenRouter runtime and by Aico's platform catalog sync.
 *
 * The unfiltered `/models` list is text-first and omits dedicated image/video
 * generators. Merge `output_modalities=image` and `=video` so Create pickers
 * see the full set (Flux, Veo, Kling, …).
 */
export const fetchOpenRouterModels = async () => {
  const [textModels, imageModels, videoModels, videoPricingModels] = await Promise.all([
    fetchOpenRouterModelPage(),
    fetchOpenRouterModelPage('image'),
    fetchOpenRouterModelPage('video'),
    fetchOpenRouterVideoModelPage().catch(() => []),
  ]);
  const videoPricingById = new Map(videoPricingModels.map((model) => [model.id, model]));
  const formattedModels = mergeOpenRouterModelPages([textModels, imageModels, videoModels]).map(
    (model) => mapOpenRouterModelCard(model, videoPricingById.get(model.id)),
  );
  const models = await processMultiProviderModelList(formattedModels, 'openrouter');

  // Same post-pass as openaiCompatibleFactory.models(): synthesize `:image`
  // clones for imageOutput / whitelisted generators so the Image tab populates.
  return postProcessModelList(models);
};
