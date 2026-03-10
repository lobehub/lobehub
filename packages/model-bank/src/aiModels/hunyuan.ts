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
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.975,
              '[0.032, infinity]': 5.3,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 15.9,
              '[0.032, infinity]': 21.2,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.18,
              '[0.032, infinity]': 4.505,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 7.95,
              '[0.032, infinity]': 11.13,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 92_000,
    description:
      'Greatly improves hard math, logic, and coding, boosts output stability, and enhances long-text capability.',
    displayName: 'Hunyuan T1 20250711',
    id: 'hunyuan-t1-20250711',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-11',
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
    contextWindowTokens: 92_000,
    description:
      'Improves creative writing and composition, strengthens frontend coding, math, and logic reasoning, and enhances instruction following.',
    displayName: 'Hunyuan T1 20250529',
    id: 'hunyuan-t1-20250529',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-29',
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
    contextWindowTokens: 92_000,
    description:
      'Improves project-level code generation and writing quality, strengthens multi-turn topic understanding and ToB instruction following, improves word-level understanding, and reduces mixed simplified/traditional and Chinese/English output issues.',
    displayName: 'Hunyuan T1 20250403',
    id: 'hunyuan-t1-20250403',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-03',
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
    contextWindowTokens: 92_000,
    description:
      'Builds balanced arts and STEM capabilities with strong long-text information capture. Supports reasoning answers for math, logic, science, and code problems across difficulty levels.',
    displayName: 'Hunyuan T1 20250321',
    id: 'hunyuan-t1-20250321',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-21',
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
      search: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Uses improved routing to mitigate load balancing and expert collapse. Achieves 99.9% needle-in-a-haystack on long context. MOE-32K offers strong value while handling long inputs.',
    displayName: 'Hunyuan Standard',
    id: 'hunyuan-standard',
    maxOutput: 2000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-10',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      search: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Uses improved routing to mitigate load balancing and expert collapse. Achieves 99.9% needle-in-a-haystack on long context. MOE-256K further expands context length and quality.',
    displayName: 'Hunyuan Standard 256K',
    id: 'hunyuan-standard-256K',
    maxOutput: 6000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-10',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      search: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Hunyuan-large has ~389B total parameters and ~52B activated, the largest and strongest open MoE model in a Transformer architecture.',
    displayName: 'Hunyuan Large',
    id: 'hunyuan-large',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-10',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      search: true,
    },
    contextWindowTokens: 134_000,
    description:
      'Excels at long-document tasks like summarization and QA while also handling general generation. Strong at long-text analysis and generation for complex, detailed content.',
    displayName: 'Hunyuan Large Longcontext',
    id: 'hunyuan-large-longcontext',
    maxOutput: 6000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-18',
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
    contextWindowTokens: 32_000,
    description:
      'General experience improvements across NLP understanding, writing, chat, QA, translation, and domains; more human-like responses, better clarification on ambiguous intent, improved word parsing, higher creative quality and interactivity, and stronger multi-turn conversations.',
    displayName: 'Hunyuan Turbo',
    id: 'hunyuan-turbo-latest',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-10',
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
    contextWindowTokens: 32_000,
    description:
      'This version boosts instruction scaling for better generalization, significantly improves math/code/logic reasoning, enhances word-level understanding, and improves writing quality.',
    displayName: 'Hunyuan Turbo 20241223',
    id: 'hunyuan-turbo-20241223',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-10',
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
    contextWindowTokens: 134_000,
    description:
      'Excels at long-document tasks like summarization and QA while also handling general generation. Strong at long-text analysis and generation for complex, detailed content.',
    displayName: 'Hunyuan TurboS LongText 128K',
    id: 'hunyuan-turbos-longtext-128k-20250325',
    maxOutput: 6000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-25',
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
