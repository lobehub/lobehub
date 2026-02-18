import type { AIChatModelCard } from '../types/aiModel';

// https://cloud.tencent.com/document/product/1729/104753
const hunyuanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Release Features: The model base has been upgraded from TurboS to **Hunyuan 2.0**, resulting in comprehensive capability improvements. It significantly enhances the model’s ability to follow complex instructions, understand multi-turn and long-form text, handle code, operate as an agent, and perform reasoning tasks.',
    displayName: 'Tencent HY 2.0 Think',
    enabled: true,
    id: 'hunyuan-2.0-thinking-20251109',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-09',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Release Features: The model base has been upgraded from TurboS to **Hunyuan 2.0**, resulting in comprehensive capability improvements. It significantly enhances instruction-following, multi-turn and long-form text understanding, literary creation, knowledge accuracy, coding, and reasoning abilities.',
    displayName: 'Tencent HY 2.0 Instruct',
    enabled: true,
    id: 'hunyuan-2.0-instruct-20251111',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-11',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 256_000,
    description:
      'The first hybrid reasoning model from Hunyuan, upgraded from hunyuan-standard-256K (80B total, 13B active). It defaults to slow thinking and supports fast/slow switching via params or prefixing /no_think. Overall capability is improved over the previous generation, especially in math, science, long-text understanding, and agent tasks.',
    displayName: 'Hunyuan A13B',
    enabled: true,
    id: 'hunyuan-a13b',
    maxOutput: 32_000,
    releasedAt: '2025-06-25',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 96_000,
    description:
      'Significantly improves the slow-thinking model on hard math, complex reasoning, difficult coding, instruction following, and creative writing quality.',
    displayName: 'Hunyuan T1',
    id: 'hunyuan-t1-latest',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-22',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 44_000,
    description:
      'The latest Hunyuan TurboS flagship model with stronger reasoning and a better overall experience.',
    displayName: 'Hunyuan TurboS',
    enabled: true,
    id: 'hunyuan-turbos-latest',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-16',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 256_000,
    description:
      'Upgraded to an MoE architecture with a 256k context window, leading many open models across NLP, code, math, and industry benchmarks.',
    displayName: 'Hunyuan Lite',
    enabled: true,
    id: 'hunyuan-lite',
    maxOutput: 6000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-30',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 24_000,
    description:
      'A fast-thinking image-to-text model built on the TurboS text base, showing notable improvements over the previous version in fundamental image recognition and image analysis reasoning.',
    displayName: 'Hunyuan Vision 1.5 Instruct',
    id: 'hunyuan-vision-1.5-instruct',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-17',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 40_000,
    description:
      'Latest t1-vision deep reasoning model with major improvements in VQA, visual grounding, OCR, charts, solving photographed problems, and image-based creation, plus stronger English and low-resource languages.',
    displayName: 'Hunyuan T1 Vision 20250916',
    id: 'hunyuan-t1-vision-20250916',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-16',
    type: 'chat',
  },
];

export const allModels = [...hunyuanChatModels];

export default allModels;
