import type { ModelParamsSchema } from 'model-bank';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createOpenRouterImage } from './createImage';
import type { OpenRouterImageModelCard, OpenRouterModelCard, OpenRouterReasoning } from './type';

const defaultHeaders = {
  'HTTP-Referer': 'https://lobehub.com',
  'X-Title': 'LobeHub',
};

const formatPrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  return Number((Number(price) * 1e6).toPrecision(5));
};

const imageParameters = (model: OpenRouterImageModelCard): ModelParamsSchema => {
  const parameters: ModelParamsSchema = { prompt: { default: '' } };

  // The catalog descriptors describe accepted values, not provider defaults.
  const enumParameters = {
    aspect_ratio: 'aspectRatio',
    quality: 'quality',
    resolution: 'resolution',
    size: 'size',
  } as const;

  for (const [remoteKey, key] of Object.entries(enumParameters)) {
    const descriptor = model.supported_parameters[remoteKey];
    if (descriptor?.type === 'enum' && descriptor.values.length > 0) {
      parameters[key] = { default: descriptor.values[0], enum: descriptor.values };
    }
  }

  // A boolean descriptor means the numeric seed parameter is accepted.
  const seed = model.supported_parameters.seed;
  if (seed?.type === 'boolean') {
    parameters.seed = { default: null };
  } else if (seed?.type === 'range') {
    parameters.seed = { default: null, max: seed.max, min: seed.min };
  }

  const references = model.supported_parameters.input_references;
  const maxReferences = references?.type === 'range' ? Math.min(16, references.max) : 16;
  if (model.architecture.input_modalities.includes('image') && maxReferences > 0) {
    parameters.imageUrls = { default: [], maxCount: maxReferences };
  }

  return parameters;
};

export const params = {
  baseURL: 'https://openrouter.ai/api/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        reasoning_effort,
        thinking,
        reasoning: _reasoning,
        thinkingLevel,
        imageAspectRatio,
        imageResolution,
        model,
        ...rest
      } = payload;

      let reasoning: OpenRouterReasoning | undefined;

      if (
        thinking?.type ||
        thinking?.budget_tokens !== undefined ||
        reasoning_effort ||
        thinkingLevel
      ) {
        if (thinking?.type === 'disabled') {
          reasoning = { enabled: false };
        } else if (thinking?.budget_tokens !== undefined) {
          reasoning = {
            max_tokens: thinking?.budget_tokens,
          };
        } else if (reasoning_effort) {
          reasoning = { effort: reasoning_effort };
        } else if (thinkingLevel) {
          reasoning = { effort: thinkingLevel };
        }
      }

      // Add modalities and image_config for image generation models
      const isImageModel = model.includes('-image') || model.includes('flux');
      const modalities =
        (payload as any).modalities ?? (isImageModel ? ['image', 'text'] : undefined);

      // Map imageResolution to image_size: '512' → '0.5K', others pass through.
      // OpenRouter's image_size field expects '0.5K' for 512px output; the rest
      // ('1K'/'2K'/'4K') are passed through verbatim.
      const imageSizeValue = imageResolution
        ? imageResolution === '512'
          ? '0.5K'
          : imageResolution
        : undefined;

      // 'auto' means use model default — omit the parameter
      const aspectRatioValue =
        imageAspectRatio && imageAspectRatio !== 'auto' ? imageAspectRatio : undefined;

      const image_config =
        (payload as any).image_config ??
        (isImageModel && (aspectRatioValue || imageSizeValue)
          ? {
              ...(aspectRatioValue && { aspect_ratio: aspectRatioValue }),
              ...(imageSizeValue && { image_size: imageSizeValue }),
            }
          : undefined);

      return {
        ...rest,
        ...(image_config && { image_config }),
        ...(modalities && { modalities }),
        model: payload.enabledSearch ? `${payload.model}:online` : payload.model,
        ...(reasoning && { reasoning }),
        stream: payload.stream ?? true,
      } as any;
    },
  },
  constructorOptions: { defaultHeaders },
  createImage: createOpenRouterImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENROUTER_CHAT_COMPLETION === '1',
  },
  models: async ({ client, options }) => {
    const baseURL = client.baseURL.replace(/\/+$/, '');
    const fetchCatalog = options?.fetch ?? fetch;
    const headers = new Headers(options?.defaultHeaders ?? defaultHeaders);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${client.apiKey}`);
    const response = await fetchCatalog(`${baseURL}/models`, { headers });
    if (!response.ok) {
      throw new Error(`OpenRouter models API request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { data: OpenRouterModelCard[] };
    const modelList = data.data;

    const imageResponse = await fetchCatalog(`${baseURL}/images/models`, { headers });
    if (!imageResponse.ok) {
      throw new Error(
        `OpenRouter image models API request failed with status ${imageResponse.status}`,
      );
    }

    const imageData = (await imageResponse.json()) as { data: OpenRouterImageModelCard[] };

    // Process the model info fetched from the frontend and convert to standard format
    const formattedModels = modelList.map((model) => {
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
    });

    // Dedicated image catalog entries take precedence, including their API-derived schema.
    const imageModelIds = new Set(imageData.data.map((model) => model.id));
    const imageModels = imageData.data.map((model) => ({
      description: model.description,
      displayName: model.name,
      id: model.id,
      parameters: imageParameters(model),
      releasedAt: new Date(model.created * 1000).toISOString().split('T')[0],
      type: 'image' as const,
      vision: model.architecture.input_modalities.includes('image'),
    }));

    return await processMultiProviderModelList(
      [...formattedModels.filter((model) => !imageModelIds.has(model.id)), ...imageModels],
      'openrouter',
    );
  },
  provider: ModelProvider.OpenRouter,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOpenRouterAI = createOpenAICompatibleRuntime(params);
