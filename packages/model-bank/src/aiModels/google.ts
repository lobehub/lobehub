import { CHAT_MODEL_IMAGE_GENERATION_PARAMS, ModelParamsSchema } from '../standard-parameters';
import { AIChatModelCard, AIImageModelCard } from '../types';

/**
 * gemini implicit caching not extra cost
 * https://openrouter.ai/docs/features/prompt-caching#implicit-caching
 */

const googleChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Gemini 3 Pro Preview 是 Google 最新的预览版模型，具备强大的推理和多模态能力。',
    displayName: 'Gemini 3 Pro Preview',
    enabled: true,
    id: 'gemini-3-pro-preview',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-01',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Latest release of Gemini Pro',
    displayName: 'Gemini Pro Latest',
    id: 'gemini-pro-latest',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.31, upTo: 200_000 },
            { rate: 0.625, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.25, upTo: 200_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 200_000 },
            { rate: 15, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Latest release of Gemini Flash',
    displayName: 'Gemini Flash Latest',
    id: 'gemini-flash-latest',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Latest release of Gemini Flash-Lite',
    displayName: 'Gemini Flash-Lite Latest',
    id: 'gemini-flash-lite-latest',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Pro 是 Google 最先进的思维模型，能够对代码、数学和STEM领域的复杂问题进行推理，以及使用长上下文分析大型数据集、代码库和文档。',
    displayName: 'Gemini 2.5 Pro',
    enabled: true,
    id: 'gemini-2.5-pro',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.31, upTo: 200_000 },
            { rate: 0.625, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.25, upTo: 200_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 200_000 },
            { rate: 15, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Pro Preview 是 Google 最先进的思维模型，能够对代码、数学和STEM领域的复杂问题进行推理，以及使用长上下文分析大型数据集、代码库和文档。',
    displayName: 'Gemini 2.5 Pro Preview 06-05',
    id: 'gemini-2.5-pro-preview-06-05',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.31, upTo: 200_000 },
            { rate: 0.625, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.25, upTo: 200_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 200_000 },
            { rate: 15, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-06-05',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Pro Preview 是 Google 最先进的思维模型，能够对代码、数学和STEM领域的复杂问题进行推理，以及使用长上下文分析大型数据集、代码库和文档。',
    displayName: 'Gemini 2.5 Pro Preview 05-06',
    id: 'gemini-2.5-pro-preview-05-06',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.31, upTo: 200_000 },
            { rate: 0.625, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.25, upTo: 200_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 200_000 },
            { rate: 15, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-05-06',
    settings: {
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Gemini 2.5 Flash 是 Google 性价比最高的模型，提供全面的功能。',
    displayName: 'Gemini 2.5 Flash',
    enabled: true,
    id: 'gemini-2.5-flash',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Preview release (Septempber 25th, 2025) of Gemini 2.5 Flash',
    displayName: 'Gemini 2.5 Flash Preview Sep 2025',
    id: 'gemini-2.5-flash-preview-09-2025',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-25',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Gemini 2.5 Flash Preview 是 Google 性价比最高的模型，提供全面的功能。',
    displayName: 'Gemini 2.5 Flash Preview 05-20',
    id: 'gemini-2.5-flash-preview-05-20',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.0375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-20',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description:
      'Nano Banana 是 Google 最新、最快、最高效的原生多模态模型，它允许您通过对话生成和编辑图像。',
    displayName: 'Nano Banana',
    enabled: true,
    id: 'gemini-2.5-flash-image',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description:
      'Nano Banana 是 Google 最新、最快、最高效的原生多模态模型，它允许您通过对话生成和编辑图像。',
    displayName: 'Nano Banana (Preview)',
    id: 'gemini-2.5-flash-image-preview',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Gemini 2.5 Flash-Lite 是 Google 最小、性价比最高的模型，专为大规模使用而设计。',
    displayName: 'Gemini 2.5 Flash-Lite',
    id: 'gemini-2.5-flash-lite',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-22',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Preview release (September 25th, 2025) of Gemini 2.5 Flash-Lite',
    displayName: 'Gemini 2.5 Flash-Lite Preview Sep 2025',
    id: 'gemini-2.5-flash-lite-preview-09-2025',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-25',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Flash-Lite Preview 是 Google 最小、性价比最高的模型，专为大规模使用而设计。',
    displayName: 'Gemini 2.5 Flash-Lite Preview 06-17',
    id: 'gemini-2.5-flash-lite-preview-06-17',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-11',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description:
      'Gemini 2.0 Flash 提供下一代功能和改进，包括卓越的速度、原生工具使用、多模态生成和1M令牌上下文窗口。',
    displayName: 'Gemini 2.0 Flash',
    id: 'gemini-2.0-flash',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    settings: {
      extendParams: ['urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description:
      'Gemini 2.0 Flash 提供下一代功能和改进，包括卓越的速度、原生工具使用、多模态生成和1M令牌上下文窗口。',
    displayName: 'Gemini 2.0 Flash 001',
    id: 'gemini-2.0-flash-001',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    settings: {
      extendParams: ['urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description: 'Gemini 2.0 Flash 预览模型，支持图像生成',
    displayName: 'Gemini 2.0 Flash Preview Image Generation',
    id: 'gemini-2.0-flash-preview-image-generation',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageGeneration', rate: 0.039, strategy: 'fixed', unit: 'image' },
      ],
    },
    releasedAt: '2025-05-07',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description: 'Gemini 2.0 Flash 实验模型，支持图像生成',
    displayName: 'Gemini 2.0 Flash (Image Generation) Experimental',
    id: 'gemini-2.0-flash-exp-image-generation',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-14',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description: 'Gemini 2.0 Flash 模型变体，针对成本效益和低延迟等目标进行了优化。',
    displayName: 'Gemini 2.0 Flash-Lite',
    id: 'gemini-2.0-flash-lite',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description: 'Gemini 2.0 Flash 模型变体，针对成本效益和低延迟等目标进行了优化。',
    displayName: 'Gemini 2.0 Flash-Lite 001',
    id: 'gemini-2.0-flash-lite-001',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description: 'Gemini 2.0 Flash 模型变体，针对成本效益和低延迟等目标进行了优化。',
    displayName: 'Gemini 2.0 Flash Exp',
    id: 'gemini-2.0-flash-exp',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 32_768,
    description:
      'LearnLM 是一个实验性的、特定于任务的语言模型，经过训练以符合学习科学原则，可在教学和学习场景中遵循系统指令，充当专家导师等。',
    displayName: 'LearnLM 2.0 Flash Experimental',
    id: 'learnlm-2.0-flash-experimental',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 40_959,
    description:
      'LearnLM 是一个实验性的、特定于任务的语言模型，经过训练以符合学习科学原则，可在教学和学习场景中遵循系统指令，充当专家导师等。',
    displayName: 'LearnLM 1.5 Pro Experimental',
    id: 'learnlm-1.5-pro-experimental',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-11-19',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description: 'Gemini 1.5 Flash 002 是一款高效的多模态模型，支持广泛应用的扩展。',
    displayName: 'Gemini 1.5 Flash 002',
    id: 'gemini-1.5-flash-002', // Deprecated on 2025-09-24
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_008_192,
    description:
      'Gemini 1.5 Pro 002 是最新的生产就绪模型，提供更高质量的输出，特别在数学、长上下文和视觉任务方面有显著提升。',
    displayName: 'Gemini 1.5 Pro 002',
    id: 'gemini-1.5-pro-002', // Deprecated on 2025-09-24
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.3125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-24',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description: 'Gemini 1.5 Flash 8B 是一款高效的多模态模型，支持广泛应用的扩展。',
    displayName: 'Gemini 1.5 Flash 8B',
    id: 'gemini-1.5-flash-8b-latest',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.0375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-03',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768 + 8192,
    displayName: 'Gemma 3 1B',
    id: 'gemma-3-1b-it',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768 + 8192,
    displayName: 'Gemma 3 4B',
    id: 'gemma-3-4b-it',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768 + 8192,
    displayName: 'Gemma 3 12B',
    id: 'gemma-3-12b-it',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072 + 8192,
    displayName: 'Gemma 3 27B',
    id: 'gemma-3-27b-it',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 2048 + 8192,
    displayName: 'Gemma 3n E2B',
    id: 'gemma-3n-e2b-it',
    maxOutput: 2048,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 2048 + 8192,
    displayName: 'Gemma 3n E4B',
    id: 'gemma-3n-e4b-it',
    maxOutput: 2048,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

// Common parameters for Imagen models
export const imagenGenParameters: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: ['1:1', '16:9', '9:16', '3:4', '4:3'],
  },
  prompt: { default: '' },
};

const NANO_BANANA_ASPECT_RATIOS = [
  '1:1', // 1024x1024
  '2:3', // 832x1248
  '3:2', // 1248x832
  '3:4', // 864x1184
  '4:3', // 1184x864
  '4:5', // 896x1152
  '5:4', // 1152x896
  '9:16', // 768x1344
  '16:9', // 1344x768
  '21:9', // 1536x672
];

export const nanoBananaParameters: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: NANO_BANANA_ASPECT_RATIOS,
  },
  imageUrls: {
    default: [],
  },
  prompt: { default: '' },
};

/* eslint-disable sort-keys-fix/sort-keys-fix */
const googleImageModels: AIImageModelCard[] = [
  {
    displayName: 'Nano Banana',
    id: 'gemini-2.5-flash-image:image',
    enabled: true,
    type: 'image',
    description:
      'Nano Banana 是 Google 最新、最快、最高效的原生多模态模型，它允许您通过对话生成和编辑图像。',
    releasedAt: '2025-08-26',
    parameters: nanoBananaParameters,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
  },
  {
    displayName: 'Nano Banana (Preview)',
    id: 'gemini-2.5-flash-image-preview:image',
    type: 'image',
    description:
      'Nano Banana 是 Google 最新、最快、最高效的原生多模态模型，它允许您通过对话生成和编辑图像。',
    releasedAt: '2025-08-26',
    parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
  },
  {
    displayName: 'Imagen 4',
    id: 'imagen-4.0-generate-001',
    enabled: true,
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series',
    organization: 'Deepmind',
    releasedAt: '2025-08-15',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
  },
  {
    displayName: 'Imagen 4 Ultra',
    id: 'imagen-4.0-ultra-generate-001',
    enabled: true,
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series Ultra version',
    organization: 'Deepmind',
    releasedAt: '2025-08-15',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
  },
  {
    displayName: 'Imagen 4 Fast',
    id: 'imagen-4.0-fast-generate-001',
    enabled: true,
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series Fast version',
    organization: 'Deepmind',
    releasedAt: '2025-08-15',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
    },
  },
  {
    displayName: 'Imagen 4 Preview 06-06',
    id: 'imagen-4.0-generate-preview-06-06',
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series',
    organization: 'Deepmind',
    releasedAt: '2024-06-06',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
  },
  {
    displayName: 'Imagen 4 Ultra Preview 06-06',
    id: 'imagen-4.0-ultra-generate-preview-06-06',
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series Ultra version',
    organization: 'Deepmind',
    releasedAt: '2025-06-11',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
  },
];
/* eslint-enable sort-keys-fix/sort-keys-fix */

export const allModels = [...googleChatModels, ...googleImageModels];

export default allModels;
