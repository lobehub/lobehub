import type { Pricing, VideoModelParamsSchema } from 'model-bank';
import { CHAT_MODEL_IMAGE_GENERATION_PARAMS, DEFAULT_VIDEO_GENERATION_PARAMS } from 'model-bank';

import { processMultiProviderModelList } from '../../utils/modelParse';
import { postProcessModelList } from '../../utils/postProcessModelList';
import {
  compactUnits,
  fixedUnit,
  formatPrice,
  getDefaultVideoDuration,
  getDefaultVideoResolution,
  mergePricing,
  parsePrice,
  resolveOpenRouterImageEndpointPricing,
  resolveOpenRouterVideoPricing,
  withoutImagePricingUnits,
} from './openRouterPricing';
import type {
  OpenRouterImageEndpoint,
  OpenRouterImageModelListItem,
  OpenRouterModelCard,
  OpenRouterVideoModelCard,
} from './type';

/** Used when model-bank's Create Video defaults are unavailable at runtime. */
const OPENROUTER_VIDEO_PARAM_DEFAULTS: VideoModelParamsSchema = {
  aspectRatio: {
    default: '16:9',
    enum: ['16:9', '9:16', '1:1'],
  },
  duration: { default: 5, max: 15, min: 1 },
  imageUrl: { default: null },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: ['720p', '1080p'],
  },
};

const videoParamDefaults = (): VideoModelParamsSchema =>
  (DEFAULT_VIDEO_GENERATION_PARAMS as VideoModelParamsSchema | undefined) ??
  OPENROUTER_VIDEO_PARAM_DEFAULTS;

export { resolveOpenRouterVideoPricing } from './openRouterPricing';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/images/models';
const OPENROUTER_VIDEO_MODELS_URL = 'https://openrouter.ai/api/v1/videos/models';

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
    // Generic /models `image` is often input-image tokens or a per-image rate; dedicated
    // image endpoints overwrite this when they succeed.
    fixedUnit('imageInput', imageInput, 'image'),
    // Token-priced generators must use imageOutput so computeChatCost can bill
    // outputImageTokens. Dedicated endpoints overwrite unit/strategy when present.
    fixedUnit('imageOutput', imageOutput, 'millionTokens'),
    fixedUnit('videoGeneration', videoOutput, 'millionTokens'),
  ]);

  if (units.length === 0) return undefined;
  return { currency: 'USD', units };
};

const resolveOpenRouterVideoParameters = (
  model?: OpenRouterVideoModelCard,
): VideoModelParamsSchema => {
  const defaults = videoParamDefaults();
  if (!model) return defaults;

  const aspectRatios = model.supported_aspect_ratios;
  const resolutions = model.supported_resolutions;
  const durations = model.supported_durations;
  const defaultDuration = getDefaultVideoDuration(durations);

  return {
    ...defaults,
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
  imagePricing?: Pricing,
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
      imagePricing
        ? withoutImagePricingUnits(mapOpenRouterPricing(pricing, outputModalities))
        : mapOpenRouterPricing(pricing, outputModalities),
      mergePricing(
        resolvedType === 'image' || hasImageOutput ? imagePricing : undefined,
        resolvedType === 'video' && videoModel
          ? resolveOpenRouterVideoPricing(videoModel)
          : undefined,
      ),
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

const imageEndpointsUrl = (item: OpenRouterImageModelListItem) => {
  if (item.endpoints?.startsWith('http')) return item.endpoints;
  if (item.endpoints?.startsWith('/')) return `https://openrouter.ai${item.endpoints}`;
  return `${OPENROUTER_IMAGE_MODELS_URL}/${item.id}/endpoints`;
};

const fetchJson = async <T>(url: string): Promise<T | undefined> => {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  return (await response.json()) as T;
};

/** Fail-soft: a missing/403 endpoints page must not empty the catalog. */
export const fetchOpenRouterImagePricingById = async (): Promise<Map<string, Pricing>> => {
  const list = await fetchJson<{ data?: OpenRouterImageModelListItem[] }>(
    OPENROUTER_IMAGE_MODELS_URL,
  ).catch(() => undefined);
  const items = list?.data ?? [];
  if (items.length === 0) return new Map();

  const entries = await Promise.all(
    items.map(async (item) => {
      try {
        const payload = await fetchJson<{ endpoints?: OpenRouterImageEndpoint[] }>(
          imageEndpointsUrl(item),
        );
        const pricing = resolveOpenRouterImageEndpointPricing(payload?.endpoints ?? []);
        if (!pricing) return undefined;
        return [item.id, pricing] as const;
      } catch {
        return undefined;
      }
    }),
  );

  return new Map(entries.filter((entry): entry is readonly [string, Pricing] => !!entry));
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
  const [textModels, imageModels, videoModels, videoPricingModels, imagePricingById] =
    await Promise.all([
      fetchOpenRouterModelPage(),
      fetchOpenRouterModelPage('image'),
      fetchOpenRouterModelPage('video'),
      fetchOpenRouterVideoModelPage().catch(() => []),
      fetchOpenRouterImagePricingById().catch(() => new Map<string, Pricing>()),
    ]);
  const videoPricingById = new Map(videoPricingModels.map((model) => [model.id, model]));
  const formattedModels = mergeOpenRouterModelPages([textModels, imageModels, videoModels]).map(
    (model) =>
      mapOpenRouterModelCard(model, videoPricingById.get(model.id), imagePricingById.get(model.id)),
  );
  const models = await processMultiProviderModelList(formattedModels, 'openrouter');

  // Same post-pass as openaiCompatibleFactory.models(): synthesize `:image`
  // clones for imageOutput / whitelisted generators so the Image tab populates.
  return postProcessModelList(models);
};
