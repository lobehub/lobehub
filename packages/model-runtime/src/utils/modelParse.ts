import type { ChatModelCard } from '@lobechat/types';
import type { AIBaseModelCard, AiModelSettings, ExtendParamsType } from 'model-bank';

import type { ModelProviderKey } from '../types';

export interface ModelProcessorConfig {
  excludeKeywords?: readonly string[]; // Do not add tags to models that match
  functionCallKeywords?: readonly string[];
  imageOutputKeywords?: readonly string[];
  reasoningKeywords?: readonly string[];
  searchKeywords?: readonly string[];
  videoKeywords?: readonly string[];
  visionKeywords?: readonly string[];
}

// Default keyword: any model ID containing -search is considered to support internet search
const DEFAULT_SEARCH_KEYWORDS = ['-search'] as const;

// Model capability tag keyword configuration
export const MODEL_LIST_CONFIGS = {
  anthropic: {
    functionCallKeywords: ['claude'],
    reasoningKeywords: ['-3-7', '3.7', '-4'],
    visionKeywords: ['claude'],
  },
  comfyui: {
    // ComfyUI models are image generation models, no chat capabilities
    functionCallKeywords: [],
    reasoningKeywords: [],
    visionKeywords: [],
  },
  deepseek: {
    functionCallKeywords: ['v3', 'r1', 'deepseek-chat'],
    reasoningKeywords: ['r1', 'deepseek-reasoner', 'v3.1', 'v3.2'],
    visionKeywords: ['ocr'],
  },
  google: {
    excludeKeywords: ['tts'],
    functionCallKeywords: ['gemini', '!-image-'],
    imageOutputKeywords: ['-image-'],
    reasoningKeywords: ['thinking', '-2.5-', '!-image-', '-3-'],
    searchKeywords: ['-search', '!-image-'],
    videoKeywords: ['-2.5-', '!-image-', '-3-'],
    visionKeywords: ['gemini', 'learnlm'],
  },
  inclusionai: {
    functionCallKeywords: ['ling-'],
    reasoningKeywords: ['ring-'],
    visionKeywords: ['ming-'],
  },
  llama: {
    functionCallKeywords: ['llama-3.2', 'llama-3.3', 'llama-4'],
    reasoningKeywords: [],
    visionKeywords: ['llava'],
  },
  longcat: {
    functionCallKeywords: ['longcat'],
    reasoningKeywords: ['thinking'],
    visionKeywords: [],
  },
  minimax: {
    functionCallKeywords: ['minimax'],
    reasoningKeywords: ['-m'],
    visionKeywords: ['-vl', 'Text-01'],
  },
  moonshot: {
    functionCallKeywords: ['moonshot', 'kimi'],
    reasoningKeywords: ['thinking'],
    visionKeywords: ['vision', 'kimi-latest', 'kimi-thinking-preview'],
  },
  openai: {
    excludeKeywords: ['audio'],
    functionCallKeywords: ['4o', '4.1', 'o3', 'o4', 'oss'],
    reasoningKeywords: ['o1', 'o3', 'o4', 'oss'],
    visionKeywords: ['4o', '4.1', 'o4'],
  },
  qwen: {
    functionCallKeywords: [
      'qwen-max',
      'qwen-plus',
      'qwen-turbo',
      'qwen-long',
      'qwen1.5',
      'qwen2',
      'qwen2.5',
      'qwen3',
    ],
    reasoningKeywords: ['qvq', 'qwq', 'qwen3', '!-instruct-', '!-coder-', '!-max-'],
    visionKeywords: ['qvq', '-vl', '-omni'],
  },
  replicate: {
    imageOutputKeywords: [
      'flux',
      'stable-diffusion',
      'sdxl',
      'ideogram',
      'canny',
      'depth',
      'fill',
      'redux',
    ],
  },
  v0: {
    functionCallKeywords: ['v0'],
    reasoningKeywords: ['v0-1.5'],
    visionKeywords: ['v0'],
  },
  volcengine: {
    functionCallKeywords: ['1.5', '1-5', '1.6', '1-6'],
    reasoningKeywords: ['thinking', 'seed', 'ui-tars'],
    visionKeywords: ['vision', '-m', 'seed', 'ui-tars'],
  },
  wenxin: {
    functionCallKeywords: ['ernie-5', 'ernie-x1', 'pro', 'ernie-4.5-21b-a3b-thinking'],
    reasoningKeywords: ['thinking', 'ernie-x', 'ernie-4.5-vl-28b-a3b'],
    visionKeywords: ['-vl', 'ernie-5.0', 'picocr', 'qianfan-composition'],
  },
  xai: {
    functionCallKeywords: ['grok'],
    reasoningKeywords: ['mini', 'grok-4', 'grok-code-fast', '!non-reasoning'],
    visionKeywords: ['vision', 'grok-4'],
  },
  xiaomimimo: {
    functionCallKeywords: ['mimo'],
    reasoningKeywords: ['mimo'],
    visionKeywords: [],
  },
  zeroone: {
    functionCallKeywords: ['fc'],
    visionKeywords: ['vision'],
  },
  zhipu: {
    functionCallKeywords: ['glm-4', 'glm-z1'],
    reasoningKeywords: ['glm-zero', 'glm-z1', 'glm-4.'],
    visionKeywords: ['re:glm-4(\\.\\d)?v'],
  },
} as const;

// Model owner (provider) keyword configuration
export const MODEL_OWNER_DETECTION_CONFIG = {
  anthropic: ['claude'],
  comfyui: ['comfyui/'], // ComfyUI models detection - all ComfyUI models have comfyui/ prefix
  deepseek: ['deepseek'],
  google: ['gemini', 'imagen'],
  inclusionai: ['ling-', 'ming-', 'ring-'],
  llama: ['llama', 'llava'],
  longcat: ['longcat'],
  minimax: ['minimax'],
  moonshot: ['moonshot', 'kimi'],
  openai: ['o1', 'o3', 'o4', 'gpt-'],
  qwen: ['qwen', 'qwq', 'qvq'],
  replicate: [],
  v0: ['v0'],
  volcengine: ['doubao'],
  wenxin: ['ernie', 'qianfan'],
  xai: ['grok'],
  xiaomimimo: ['mimo-'],
  zeroone: ['yi-'],
  zhipu: ['glm'],
} as const;

// Image model keyword configuration
export const IMAGE_MODEL_KEYWORDS = [
  'dall-e',
  'dalle',
  'midjourney',
  'stable-diffusion',
  'sd',
  'flux',
  'imagen',
  'firefly',
  'cogview',
  'wanxiang',
  'DESCRIBE',
  'UPSCALE',
  '!gemini', // Exclude gemini models, they are chat models even if they contain -image
  '-image',
  '^V3',
  '^V_2',
  '^V_1',
] as const;

// Embedding model keyword configuration
export const EMBEDDING_MODEL_KEYWORDS = ['embedding', 'embed', 'bge', 'm3e'] as const;

/**
 * Detect whether a keyword list matches a model ID (supports multiple matching patterns)
 * @param modelId Model ID (lowercase)
 * @param keywords Keyword list, supports the following prefixes:
 *   - ^ prefix: match only at the start of model ID
 *   - ! prefix: exclude match, highest priority
 *   - re: prefix: regular expression match (supports !re: for regex exclusion)
 *   - no prefix: contains match (default behavior)
 * @returns Whether it matches (exclusion logic takes priority)
 */
const isKeywordListMatch = (modelId: string, keywords: readonly string[]): boolean => {
  const matchKeyword = (keyword: string): boolean => {
    const rawKeyword = keyword.startsWith('!') ? keyword.slice(1) : keyword;

    if (rawKeyword.startsWith('re:')) {
      try {
        return new RegExp(rawKeyword.slice(3)).test(modelId);
      } catch {
        return false;
      }
    }

    if (rawKeyword.startsWith('^')) {
      return modelId.startsWith(rawKeyword.slice(1));
    }

    return modelId.includes(rawKeyword);
  };

  // First check exclusion rules (starting with exclamation mark, including !re:)
  const excludeKeywords = keywords.filter((keyword) => keyword.startsWith('!'));
  const includeKeywords = keywords.filter((keyword) => !keyword.startsWith('!'));

  for (const excludeKeyword of excludeKeywords) {
    if (matchKeyword(excludeKeyword)) {
      return false;
    }
  }

  // Check inclusion rules
  return includeKeywords.some((keyword) => matchKeyword(keyword));
};

/**
 * Find the corresponding local model configuration based on provider type
 * @param modelId Model ID
 * @param provider Provider type
 * @returns Matching local model configuration
 */
const findKnownModelByProvider = async (
  modelId: string,
  provider: keyof typeof MODEL_LIST_CONFIGS,
): Promise<any> => {
  const lowerModelId = modelId.toLowerCase();

  try {
    // Attempt to dynamically import the corresponding configuration file
    const modules = await import('model-bank');

    // If provider configuration file doesn't exist, skip
    if (!(provider in modules)) {
      return null;
    }

    const providerModels = modules[provider as keyof typeof modules] as AIBaseModelCard[];

    // If import succeeds and has data, perform search
    if (Array.isArray(providerModels)) {
      return providerModels.find((m) => m.id.toLowerCase() === lowerModelId);
    }

    return null;
  } catch {
    // If import fails (file doesn't exist or other error), return null
    return null;
  }
};

/**
 * Detect the provider type of a single model
 * @param modelId Model ID
 * @returns Detected provider configuration key name, defaults to 'openai'
 */
export const detectModelProvider = (modelId: string): keyof typeof MODEL_LIST_CONFIGS => {
  const lowerModelId = modelId.toLowerCase();

  for (const [provider, keywords] of Object.entries(MODEL_OWNER_DETECTION_CONFIG)) {
    const hasKeyword = isKeywordListMatch(lowerModelId, keywords);

    if (hasKeyword && provider in MODEL_LIST_CONFIGS) {
      return provider as keyof typeof MODEL_LIST_CONFIGS;
    }
  }

  return 'openai';
};

/**
 * Convert timestamp to date string
 * @param timestamp Timestamp (seconds)
 * @returns Formatted date string (YYYY-MM-DD)
 */
const formatTimestampToDate = (timestamp: number): string | undefined => {
  if (timestamp === null || timestamp === undefined || Number.isNaN(timestamp)) return undefined;

  // Support both second-level and millisecond-level timestamps:
  // - If millisecond-level (>= 1e12), use as milliseconds directly;
  // - Otherwise treat as seconds, need to *1000 to convert to milliseconds
  const msTimestamp = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(msTimestamp);

  // Validate parsing result and year range (only accept 4-digit years to avoid exceeding varchar(10) YYYY-MM-DD)
  const year = date.getUTCFullYear();
  if (year < 1000 || year > 9999) return undefined;

  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return dateStr.length === 10 ? dateStr : undefined;
};

/**
 * Process releasedAt field
 * @param model Model object
 * @param knownModel Known model configuration
 * @returns Processed releasedAt value
 */
const processReleasedAt = (model: any, knownModel?: any): string | undefined => {
  // Check model.created first
  if (model.created !== undefined && model.created !== null) {
    // Check if it's in timestamp format
    if (typeof model.created === 'number' && model.created > 1_630_000_000) {
      // AiHubMix incorrect timestamp is 1626777600
      return formatTimestampToDate(model.created);
    }
    // If created is a string and already in date format, return directly
    if (typeof model.created === 'string') {
      // Anthropic: if it's '2025-02-19T00:00:00Z', only take the date part
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(model.created)) {
        return model.created.split('T')[0];
      }
      return model.created;
    }
  }

  // Fall back to original logic
  return model.releasedAt ?? knownModel?.releasedAt ?? undefined;
};

/**
 * Process model display name
 * @param displayName Original display name
 * @returns Processed display name
 */
const processDisplayName = (displayName: string): string => {
  // If it contains "Gemini 2.5 Flash Image Preview", replace the corresponding part with "Nano Banana"
  if (displayName.includes('Gemini 2.5 Flash Image Preview')) {
    return displayName.replace('Gemini 2.5 Flash Image Preview', 'Nano Banana');
  }

  return displayName;
};

const mergeExtendParams = (
  modelExtendParams?: ReadonlyArray<ExtendParamsType>,
  knownExtendParams?: ReadonlyArray<ExtendParamsType>,
  options?: { includeKnownExtendParams?: boolean },
): ExtendParamsType[] | undefined => {
  const includeKnown = options?.includeKnownExtendParams ?? true;

  const combined = [
    ...(includeKnown ? (knownExtendParams ?? []) : []),
    ...(modelExtendParams ?? []),
  ];

  if (combined.length === 0) return undefined;

  return Array.from(new Set(combined));
};

const mergeSettings = (
  modelSettings?: AiModelSettings,
  knownSettings?: AiModelSettings,
  options?: { includeKnownExtendParams?: boolean; includeSearchSettings?: boolean },
): AiModelSettings | undefined => {
  if (!modelSettings && !knownSettings) return undefined;

  const merged: AiModelSettings = {};

  if (knownSettings) {
    Object.assign(merged, knownSettings);
  }

  if (modelSettings) {
    Object.assign(merged, modelSettings);
  }

  const extendParams = mergeExtendParams(
    modelSettings?.extendParams,
    knownSettings?.extendParams,
    options,
  );
  if (extendParams) {
    merged.extendParams = extendParams;
  } else {
    delete merged.extendParams;
  }

  const includeSearchSettings = options?.includeSearchSettings ?? true;

  if (includeSearchSettings) {
    const searchImpl = modelSettings?.searchImpl ?? knownSettings?.searchImpl;
    if (searchImpl) {
      merged.searchImpl = searchImpl;
    } else {
      delete merged.searchImpl;
    }

    const searchProvider = modelSettings?.searchProvider ?? knownSettings?.searchProvider;
    if (searchProvider) {
      merged.searchProvider = searchProvider;
    } else {
      delete merged.searchProvider;
    }
  } else {
    delete merged.searchImpl;
    delete merged.searchProvider;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
};

/**
 * Get the local configuration of the model provider
 * @param provider Model provider
 * @returns Local configuration of the model provider
 */
const getProviderLocalConfig = async (provider?: ModelProviderKey): Promise<any[] | null> => {
  let providerLocalConfig: any[] | null = null;
  if (provider) {
    try {
      const modules = await import('model-bank');

      providerLocalConfig = modules[provider];
    } catch {
      // If configuration file doesn't exist or import fails, keep as null
      providerLocalConfig = null;
    }
  }
  return providerLocalConfig;
};

/**
 * Get model local configuration
 * @param providerLocalConfig Local configuration of the model provider
 * @param model Model object
 * @returns Model local configuration
 */
const getModelLocalEnableConfig = (
  providerLocalConfig: any[],
  model: { id: string },
): any | null => {
  // If providerid is provided and has local configuration, try to get the model's enabled status from it
  let providerLocalModelConfig = null;
  if (providerLocalConfig && Array.isArray(providerLocalConfig)) {
    providerLocalModelConfig = providerLocalConfig.find((m) => m.id === model.id);
  }
  return providerLocalModelConfig;
};

/**
 * Common logic for processing model cards
 */
const processModelCard = (
  model: { [key: string]: any; id: string },
  config: ModelProcessorConfig,
  knownModel?: any,
  options?: { includeKnownExtendParams?: boolean; includeSearchSettings?: boolean },
): ChatModelCard | undefined => {
  const {
    functionCallKeywords = [],
    visionKeywords = [],
    reasoningKeywords = [],
    excludeKeywords = [],
    searchKeywords = DEFAULT_SEARCH_KEYWORDS,
    imageOutputKeywords = [],
    videoKeywords = [],
  } = config;

  const isExcludedModel = isKeywordListMatch(model.id.toLowerCase(), excludeKeywords);
  const modelType =
    model.type ||
    knownModel?.type ||
    (isKeywordListMatch(
      model.id.toLowerCase(),
      IMAGE_MODEL_KEYWORDS.map((k) => k.toLowerCase()),
    )
      ? 'image'
      : isKeywordListMatch(
            model.id.toLowerCase(),
            EMBEDDING_MODEL_KEYWORDS.map((k) => k.toLowerCase()),
          )
        ? 'embedding'
        : 'chat');

  // image model can't find parameters
  if (modelType === 'image' && !model.parameters && !knownModel?.parameters) {
    return undefined;
  }

  const mergedSettings = mergeSettings(model.settings, knownModel?.settings, options);

  const formatPricing = (pricing?: {
    cachedInput?: number;
    input?: number;
    output?: number;
    units?: any[];
    writeCacheInput?: number;
  }) => {
    if (!pricing || typeof pricing !== 'object') return undefined;
    if (Array.isArray(pricing.units)) {
      return { units: pricing.units };
    }
    const { input, output, cachedInput, writeCacheInput } = pricing;
    if (
      typeof input !== 'number' &&
      typeof output !== 'number' &&
      typeof cachedInput !== 'number' &&
      typeof writeCacheInput !== 'number'
    )
      return undefined;

    const units = [];
    if (typeof input === 'number') {
      units.push({
        name: 'textInput' as const,
        rate: input,
        strategy: 'fixed' as const,
        unit: 'millionTokens' as const,
      });
    }
    if (typeof output === 'number') {
      units.push({
        name: 'textOutput' as const,
        rate: output,
        strategy: 'fixed' as const,
        unit: 'millionTokens' as const,
      });
    }
    if (typeof cachedInput === 'number') {
      units.push({
        name: 'textInput_cacheRead' as const,
        rate: cachedInput,
        strategy: 'fixed' as const,
        unit: 'millionTokens' as const,
      });
    }
    if (typeof writeCacheInput === 'number') {
      units.push({
        name: 'textInput_cacheWrite' as const,
        rate: writeCacheInput,
        strategy: 'fixed' as const,
        unit: 'millionTokens' as const,
      });
    }
    return { units };
  };

  return {
    contextWindowTokens: model.contextWindowTokens ?? knownModel?.contextWindowTokens ?? undefined,
    description: model.description ?? knownModel?.description ?? '',
    displayName: processDisplayName(model.displayName ?? knownModel?.displayName ?? model.id),
    enabled: model?.enabled || false,
    functionCall:
      model.functionCall ??
      knownModel?.abilities?.functionCall ??
      ((isKeywordListMatch(model.id.toLowerCase(), functionCallKeywords) && !isExcludedModel) ||
        false),
    id: model.id,
    imageOutput:
      model.imageOutput ??
      knownModel?.abilities?.imageOutput ??
      ((isKeywordListMatch(model.id.toLowerCase(), imageOutputKeywords) && !isExcludedModel) ||
        false),
    maxOutput: model.maxOutput ?? knownModel?.maxOutput ?? undefined,
    pricing: formatPricing(model?.pricing) ?? undefined,
    reasoning:
      model.reasoning ??
      knownModel?.abilities?.reasoning ??
      ((isKeywordListMatch(model.id.toLowerCase(), reasoningKeywords) && !isExcludedModel) ||
        false),
    releasedAt: processReleasedAt(model, knownModel),
    search:
      model.search ??
      knownModel?.abilities?.search ??
      ((isKeywordListMatch(model.id.toLowerCase(), searchKeywords) && !isExcludedModel) || false),
    type: modelType,
    // current, only image model use the parameters field
    ...(modelType === 'image' && {
      parameters: model.parameters ?? knownModel?.parameters,
    }),
    ...(mergedSettings ? { settings: mergedSettings } : {}),
    video:
      model.video ??
      knownModel?.abilities?.video ??
      ((isKeywordListMatch(model.id.toLowerCase(), videoKeywords) && !isExcludedModel) || false),
    vision:
      model.vision ??
      knownModel?.abilities?.vision ??
      ((isKeywordListMatch(model.id.toLowerCase(), visionKeywords) && !isExcludedModel) || false),
  };
};

/**
 * Process model list for a single provider
 * @param modelList Model list
 * @param config Provider configuration
 * @param provider Provider type (optional, used to prioritize matching corresponding local configuration, will only attempt to override enabled from local configuration when provider is provided)
 * @returns Processed model card list
 */
export const processModelList = async (
  modelList: Array<{ id: string }>,
  config: ModelProcessorConfig,
  provider?: keyof typeof MODEL_LIST_CONFIGS,
): Promise<ChatModelCard[]> => {
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

  // If provider is provided, try to get the local configuration for that provider
  const providerLocalConfig = await getProviderLocalConfig(provider as ModelProviderKey);

  return Promise.all(
    modelList.map(async (model) => {
      let knownModel: any = null;

      // If provider is provided, prioritize using provider-specific configuration
      if (provider) {
        knownModel = await findKnownModelByProvider(model.id, provider);
      }

      // If not found, fall back to global configuration
      if (!knownModel) {
        knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );
      }

      const processedModel = processModelCard(model, config, knownModel);

      // If provider is provided and has local configuration, try to get the model's enabled status from it
      const providerLocalModelConfig = getModelLocalEnableConfig(
        providerLocalConfig as any[],
        model,
      );

      // If model is found in local configuration, use its enabled status
      if (
        processedModel &&
        providerLocalModelConfig &&
        typeof providerLocalModelConfig.enabled === 'boolean'
      ) {
        processedModel.enabled = providerLocalModelConfig.enabled;
      }

      return processedModel;
    }),
  ).then((results) => results.filter((result) => !!result));
};

/**
 * Process model list for mixed providers
 * @param modelList Model list
 * @param providerid Optional provider ID, used to get its local configuration file
 * @returns Processed model card list
 */
export const processMultiProviderModelList = async (
  modelList: Array<{ id: string }>,
  providerid?: ModelProviderKey,
): Promise<ChatModelCard[]> => {
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

  // If providerid is provided, try to get the local configuration for that provider
  const providerLocalConfig = await getProviderLocalConfig(providerid);

  return Promise.all(
    modelList.map(async (model) => {
      const detectedProvider = detectModelProvider(model.id);
      const config = MODEL_LIST_CONFIGS[detectedProvider];

      // Prioritize using provider-specific configuration
      let knownModel = await findKnownModelByProvider(model.id, detectedProvider);

      // If not found, fall back to global configuration
      if (!knownModel) {
        knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );
      }

      const includeKnownExtendParams =
        providerid === 'aihubmix' ||
        providerid === 'newapi' ||
        detectedProvider === 'openai' ||
        detectedProvider === 'google';
      const includeSearchSettings = providerid === 'aihubmix' || providerid === 'newapi';

      // If providerid is provided and has local configuration, try to get the model's enabled status from it
      const providerLocalModelConfig = getModelLocalEnableConfig(
        providerLocalConfig as any[],
        model,
      );

      const processedModel = processModelCard(model, config, knownModel, {
        includeKnownExtendParams,
        includeSearchSettings,
      });

      if (processedModel && includeSearchSettings && providerLocalModelConfig?.settings) {
        const localSettings = providerLocalModelConfig.settings as AiModelSettings | undefined;
        const searchImpl = localSettings?.searchImpl;
        const searchProvider = localSettings?.searchProvider;

        if (searchImpl || searchProvider) {
          const updatedSettings: AiModelSettings = processedModel.settings
            ? { ...processedModel.settings }
            : ({} as AiModelSettings);

          if (searchImpl) {
            updatedSettings.searchImpl = searchImpl;
          }

          if (searchProvider) {
            updatedSettings.searchProvider = searchProvider;
          }

          processedModel.settings =
            Object.keys(updatedSettings).length > 0 ? updatedSettings : undefined;
        }
      }

      // If model is found in local configuration, use its enabled status
      if (
        processedModel &&
        providerLocalModelConfig &&
        typeof providerLocalModelConfig.enabled === 'boolean'
      ) {
        processedModel.enabled = providerLocalModelConfig.enabled;
      }

      return processedModel;
    }),
  ).then((results) => results.filter((result) => !!result));
};
