import { processMultiProviderModelList } from '../../utils/modelParse';
import type { OpenRouterModelCard } from './type';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const formatPrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  return Number((Number(price) * 1e6).toPrecision(5));
};

/**
 * Map a raw OpenRouter models API card into the flat fields consumed by
 * `processMultiProviderModelList`.
 */
export const mapOpenRouterModelCard = (model: OpenRouterModelCard) => {
  const { top_provider, architecture, pricing, supported_parameters } = model;

  const inputModalities = architecture.input_modalities || [];

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

  return {
    contextWindowTokens: top_provider.context_length || model.context_length,
    description: model.description,
    displayName,
    functionCall: supported_parameters.includes('tools'),
    id: model.id,
    maxOutput:
      typeof top_provider.max_completion_tokens === 'number'
        ? top_provider.max_completion_tokens
        : typeof model.context_length === 'number'
          ? model.context_length
          : undefined,
    pricing: {
      cachedInput: cachedInputPrice,
      input: inputPrice,
      output: outputPrice,
      writeCacheInput: writeCacheInputPrice,
    },
    reasoning: hasReasoning,
    releasedAt: new Date(model.created * 1000).toISOString().split('T')[0],
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

  return processMultiProviderModelList(formattedModels, 'openrouter');
};
