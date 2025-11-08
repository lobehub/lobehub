import type { ChatModelCard } from '@lobechat/types';
import { AIBaseModelCard } from 'model-bank';

import type { ModelProviderKey } from '../types';

export interface ModelProcessorConfig {
  excludeKeywords?: readonly string[]; // 对符合的模型不添加标签
  functionCallKeywords?: readonly string[];
  imageOutputKeywords?: readonly string[];
  reasoningKeywords?: readonly string[];
  searchKeywords?: readonly string[];
  videoKeywords?: readonly string[];
  visionKeywords?: readonly string[];
}

// 默认关键字：任意包含 -search 的模型 ID 视为支持联网搜索
const DEFAULT_SEARCH_KEYWORDS = ['-search'] as const;

// 模型能力标签关键词配置
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
    reasoningKeywords: ['thinking', '-2.5-', '!-image-'],
    searchKeywords: ['-search', '!-image-'],
    videoKeywords: ['-2.5-', '!-image-'],
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
  xai: {
    functionCallKeywords: ['grok'],
    reasoningKeywords: ['mini', 'grok-4', 'grok-code-fast', '!non-reasoning'],
    visionKeywords: ['vision', 'grok-4'],
  },
  zeroone: {
    functionCallKeywords: ['fc'],
    visionKeywords: ['vision'],
  },
  zhipu: {
    functionCallKeywords: ['glm-4', 'glm-z1'],
    reasoningKeywords: ['glm-zero', 'glm-z1', 'glm-4.5'],
    visionKeywords: ['glm-4v', 'glm-4.1v', 'glm-4.5v'],
  },
} as const;

// 模型所有者 (提供商) 关键词配置
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
  v0: ['v0'],
  volcengine: ['doubao'],
  xai: ['grok'],
  zeroone: ['yi-'],
  zhipu: ['glm'],
} as const;

// 图像模型关键词配置
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
  '!gemini', // 排除 gemini 模型，即使包含 -image 也是 chat 模型
  '-image',
  '^V3',
  '^V_2',
  '^V_1',
] as const;

// 嵌入模型关键词配置
export const EMBEDDING_MODEL_KEYWORDS = ['embedding', 'embed', 'bge', 'm3e'] as const;

/**
 * 检测关键词列表是否匹配模型ID（支持多种匹配模式）
 * @param modelId 模型ID（小写）
 * @param keywords 关键词列表，支持以下前缀：
 *   - ^ 开头：只在模型ID开头匹配
 *   - ! 开头：排除匹配，优先级最高
 *   - 无前缀：包含匹配（默认行为）
 * @returns 是否匹配（排除逻辑优先）
 */
const isKeywordListMatch = (modelId: string, keywords: readonly string[]): boolean => {
  // 先检查排除规则（感叹号开头）
  const excludeKeywords = keywords.filter((keyword) => keyword.startsWith('!'));
  const includeKeywords = keywords.filter((keyword) => !keyword.startsWith('!'));

  // 如果匹配任何排除规则，直接返回 false
  for (const excludeKeyword of excludeKeywords) {
    const keywordWithoutPrefix = excludeKeyword.slice(1);
    const isMatch = keywordWithoutPrefix.startsWith('^')
      ? modelId.startsWith(keywordWithoutPrefix.slice(1))
      : modelId.includes(keywordWithoutPrefix);

    if (isMatch) {
      return false;
    }
  }

  // 检查包含规则
  return includeKeywords.some((keyword) => {
    if (keyword.startsWith('^')) {
      // ^ 开头则只在开头匹配
      const keywordWithoutPrefix = keyword.slice(1);
      return modelId.startsWith(keywordWithoutPrefix);
    }
    // 默认行为：包含匹配
    return modelId.includes(keyword);
  });
};

/**
 * 根据提供商类型查找对应的本地模型配置
 * @param modelId 模型ID
 * @param provider 提供商类型
 * @returns 匹配的本地模型配置
 */
const findKnownModelByProvider = async (
  modelId: string,
  provider: keyof typeof MODEL_LIST_CONFIGS,
): Promise<any> => {
  const lowerModelId = modelId.toLowerCase();

  try {
    // 尝试动态导入对应的配置文件
    const modules = await import('model-bank');

    // 如果提供商配置文件不存在，跳过
    if (!(provider in modules)) {
      return null;
    }

    const providerModels = modules[provider as keyof typeof modules] as AIBaseModelCard[];

    // 如果导入成功且有数据，进行查找
    if (Array.isArray(providerModels)) {
      return providerModels.find((m) => m.id.toLowerCase() === lowerModelId);
    }

    return null;
  } catch {
    // 如果导入失败（文件不存在或其他错误），返回 null
    return null;
  }
};

/**
 * 检测单个模型的提供商类型
 * @param modelId 模型ID
 * @returns 检测到的提供商配置键名，默认为 'openai'
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
 * 将时间戳转换为日期字符串
 * @param timestamp 时间戳（秒）
 * @returns 格式化的日期字符串 (YYYY-MM-DD)
 */
const formatTimestampToDate = (timestamp: number): string | undefined => {
  if (timestamp === null || timestamp === undefined || Number.isNaN(timestamp)) return undefined;

  // 支持秒级或毫秒级时间戳：
  // - 如果是毫秒级（>= 1e12），直接当作毫秒；
  // - 否则视为秒，需要 *1000 转为毫秒
  const msTimestamp = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(msTimestamp);

  // 验证解析结果和年份范围（只接受 4 位年份，避免超出 varchar(10) 的 YYYY-MM-DD）
  const year = date.getUTCFullYear();
  if (year < 1000 || year > 9999) return undefined;

  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return dateStr.length === 10 ? dateStr : undefined;
};

/**
 * 处理 releasedAt 字段
 * @param model 模型对象
 * @param knownModel 已知模型配置
 * @returns 处理后的 releasedAt 值
 */
const processReleasedAt = (model: any, knownModel?: any): string | undefined => {
  // 优先检查 model.created
  if (model.created !== undefined && model.created !== null) {
    // 检查是否为时间戳格式
    if (typeof model.created === 'number' && model.created > 1_630_000_000) {
      // AiHubMix 错误时间戳为 1626777600
      return formatTimestampToDate(model.created);
    }
    // 如果 created 是字符串且已经是日期格式，直接返回
    if (typeof model.created === 'string') {
      // Anthropic：若为 '2025-02-19T00:00:00Z' 只取日期部分
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(model.created)) {
        return model.created.split('T')[0];
      }
      return model.created;
    }
  }

  // 回退到原有逻辑
  return model.releasedAt ?? knownModel?.releasedAt ?? undefined;
};

/**
 * 处理模型显示名称
 * @param displayName 原始显示名称
 * @returns 处理后的显示名称
 */
const processDisplayName = (displayName: string): string => {
  // 如果包含 "Gemini 2.5 Flash Image Preview"，替换对应部分为 "Nano Banana"
  if (displayName.includes('Gemini 2.5 Flash Image Preview')) {
    return displayName.replace('Gemini 2.5 Flash Image Preview', 'Nano Banana');
  }

  return displayName;
};

/**
 * 获取模型提供商的本地配置
 * @param provider 模型提供商
 * @returns 模型提供商的本地配置
 */
const getProviderLocalConfig = async (provider?: ModelProviderKey): Promise<any[] | null> => {
  let providerLocalConfig: any[] | null = null;
  if (provider) {
    try {
      const modules = await import('model-bank');

      providerLocalConfig = modules[provider];
    } catch {
      // 如果配置文件不存在或导入失败，保持为 null
      providerLocalConfig = null;
    }
  }
  return providerLocalConfig;
};

/**
 * 获取模型本地配置
 * @param providerLocalConfig 模型提供商的本地配置
 * @param model 模型对象
 * @returns 模型本地配置
 */
const getModelLocalEnableConfig = (
  providerLocalConfig: any[],
  model: { id: string },
): any | null => {
  // 如果提供了 providerid 且有本地配置，尝试从中获取模型的 enabled 状态
  let providerLocalModelConfig = null;
  if (providerLocalConfig && Array.isArray(providerLocalConfig)) {
    providerLocalModelConfig = providerLocalConfig.find((m) => m.id === model.id);
  }
  return providerLocalModelConfig;
};

/**
 * 处理模型卡片的通用逻辑
 */
const processModelCard = (
  model: { [key: string]: any; id: string },
  config: ModelProcessorConfig,
  knownModel?: any,
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
 * 处理单一提供商的模型列表
 * @param modelList 模型列表
 * @param config 提供商配置
 * @param provider 提供商类型（可选，用于优先匹配对应的本地配置, 当提供了 provider 时，才会尝试从本地配置覆盖 enabled）
 * @returns 处理后的模型卡片列表
 */
export const processModelList = async (
  modelList: Array<{ id: string }>,
  config: ModelProcessorConfig,
  provider?: keyof typeof MODEL_LIST_CONFIGS,
): Promise<ChatModelCard[]> => {
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

  // 如果提供了 provider，尝试获取该提供商的本地配置
  const providerLocalConfig = await getProviderLocalConfig(provider as ModelProviderKey);

  return Promise.all(
    modelList.map(async (model) => {
      let knownModel: any = null;

      // 如果提供了provider，优先使用提供商特定的配置
      if (provider) {
        knownModel = await findKnownModelByProvider(model.id, provider);
      }

      // 如果未找到，回退到全局配置
      if (!knownModel) {
        knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );
      }

      const processedModel = processModelCard(model, config, knownModel);

      // 如果提供了 provider 且有本地配置，尝试从中获取模型的 enabled 状态
      const providerLocalModelConfig = getModelLocalEnableConfig(
        providerLocalConfig as any[],
        model,
      );

      // 如果找到了本地配置中的模型，使用其 enabled 状态
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
 * 处理混合提供商的模型列表
 * @param modelList 模型列表
 * @param providerid 可选的提供商ID，用于获取其本地配置文件
 * @returns 处理后的模型卡片列表
 */
export const processMultiProviderModelList = async (
  modelList: Array<{ id: string }>,
  providerid?: ModelProviderKey,
): Promise<ChatModelCard[]> => {
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

  // 如果提供了 providerid，尝试获取该提供商的本地配置
  const providerLocalConfig = await getProviderLocalConfig(providerid);

  return Promise.all(
    modelList.map(async (model) => {
      const detectedProvider = detectModelProvider(model.id);
      const config = MODEL_LIST_CONFIGS[detectedProvider];

      // 优先使用提供商特定的配置
      let knownModel = await findKnownModelByProvider(model.id, detectedProvider);

      // 如果未找到，回退到全局配置
      if (!knownModel) {
        knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );
      }

      // 如果提供了 providerid 且有本地配置，尝试从中获取模型的 enabled 状态
      const providerLocalModelConfig = getModelLocalEnableConfig(
        providerLocalConfig as any[],
        model,
      );

      const processedModel = processModelCard(model, config, knownModel);

      // 如果找到了本地配置中的模型，使用其 enabled 状态
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
