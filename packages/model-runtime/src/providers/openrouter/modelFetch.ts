import { CHAT_MODEL_IMAGE_GENERATION_PARAMS } from 'model-bank';

import { processMultiProviderModelList } from '../../utils/modelParse';
import { postProcessModelList } from '../../utils/postProcessModelList';
import type { OpenRouterModelCard } from './type';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const formatPrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  return Number((Number(price) * 1e6).toPrecision(5));
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
export const mapOpenRouterModelCard = (model: OpenRouterModelCard) => {
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

  const isFree = inputPrice === 0 && outputPrice === 0 && !displayName.endsWith('(free)');
  if (isFree) {
    displayName += ' (free)';
  }

  const hasReasoning = supported_parameters.includes('reasoning');
  const hasImageOutput = outputModalities.includes('image');
  // Always set type explicitly so processModelCard keyword heuristics
  // (e.g. `-image` → image → drop without parameters) cannot override
  // multimodal chat+image cards before we synthesize `:image` clones.
  const resolvedType = type ?? 'chat';

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
    // Pure image generators need parameters or processModelCard drops them.
    ...(resolvedType === 'image' ? { parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS } : {}),
    pricing: {
      cachedInput: cachedInputPrice,
      input: inputPrice,
      output: outputPrice,
      writeCacheInput: writeCacheInputPrice,
    },
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

/**
 * Fetch the live OpenRouter model catalog and normalize it for LobeHub.
 * Used by the OpenRouter runtime and by Aico's platform catalog sync.
 */
export const fetchOpenRouterModels = async () => {
  const response = await fetch(OPENROUTER_MODELS_URL);
  if (!response.ok) {
    throw new Error(`OpenRouter models API request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { data: OpenRouterModelCard[] };
  const formattedModels = data.data.map(mapOpenRouterModelCard);
  const models = await processMultiProviderModelList(formattedModels, 'openrouter');

  // Same post-pass as openaiCompatibleFactory.models(): synthesize `:image`
  // clones for imageOutput / whitelisted generators so the Image tab populates.
  return postProcessModelList(models);
};
