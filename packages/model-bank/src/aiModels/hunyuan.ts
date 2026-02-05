import type { AIChatModelCard } from '../types/aiModel';

// https://cloud.tencent.com/document/product/1729/104753
const hunyuanChatModels: AIChatModelCard[] = [
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
    enabled: true,
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
    enabled: true,
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
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 44_000,
    description:
      'Upgraded pretraining data quality and post-training strategy, improving agents, English/low-resource languages, instruction following, code, and STEM capabilities.',
    displayName: 'Hunyuan TurboS 20250926',
    id: 'hunyuan-turbos-20250926',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-26',
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
      'Upgraded pretraining base with improved writing and reading comprehension, significant gains in code and STEM, and better complex instruction following.',
    displayName: 'Hunyuan TurboS 20250604',
    id: 'hunyuan-turbos-20250604',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-04',
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
      'Upgraded pretraining base to improve instruction understanding and following; alignment boosts math, code, logic, and science; improves writing quality, comprehension, translation accuracy, and knowledge QA; strengthens agent abilities, especially multi-turn understanding.',
    displayName: 'Hunyuan TurboS 20250416',
    id: 'hunyuan-turbos-20250416',
    maxOutput: 8000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-16',
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
      'Unifies math solution style and strengthens multi-turn math QA. Writing style is refined to reduce AI-like tone and add polish.',
    displayName: 'Hunyuan TurboS 20250313',
    id: 'hunyuan-turbos-20250313',
    maxOutput: 8000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-13',
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
      '基于文本 TurboS 基座生产的图生文快思考模型，相比上一版本在图像基础识别、图像分析推理等维度都有明显的效果提升。',
    displayName: '混元图生文',
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
      vision: true,
    },
    contextWindowTokens: 36_000,
    description:
      'Latest 7B multimodal model with a 32K context window, supporting Chinese/English multimodal chat, object recognition, document table understanding, and multimodal math, outperforming 7B peers on multiple benchmarks.',
    displayName: 'Hunyuan Lite Vision',
    id: 'hunyuan-lite-vision',
    maxOutput: 4000,
    releasedAt: '2024-12-12',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8000,
    description:
      'Latest multimodal model with multilingual responses and balanced Chinese/English ability.',
    displayName: 'Hunyuan Standard Vision',
    id: 'hunyuan-standard-vision',
    maxOutput: 2000,
    releasedAt: '2024-12-31',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8000,
    description:
      'Next-generation vision-language flagship using a new MoE architecture, with broad improvements in recognition, content creation, knowledge QA, and analytical reasoning.',
    displayName: 'Hunyuan Turbo Vision',
    id: 'hunyuan-turbo-vision',
    maxOutput: 2000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-11-26',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_000,
    description:
      'A vision-language model trained from Hunyuan Large for image-text understanding. Supports multi-image + text input at any resolution and improves multilingual visual understanding.',
    displayName: 'Hunyuan Large Vision',
    id: 'hunyuan-large-vision',
    maxOutput: 8000,
    releasedAt: '2025-05-26',
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
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 40_000,
    description:
      'Latest t1-vision multimodal deep reasoning model with native long chain-of-thought, significantly improved over the previous default version.',
    displayName: 'Hunyuan T1 Vision 20250619',
    id: 'hunyuan-t1-vision-20250619',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-19',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Latest TurboS vision-language flagship with major gains on image-text tasks such as entity recognition, knowledge QA, copywriting, and photo-based problem solving.',
    displayName: 'Hunyuan TurboS Vision 20250619',
    id: 'hunyuan-turbos-vision-20250619',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-19',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'A next-gen vision-language flagship based on the latest TurboS, focused on image-text understanding tasks like entity recognition, knowledge QA, copywriting, and photo-based problem solving.',
    displayName: 'Hunyuan TurboS Vision',
    id: 'hunyuan-turbos-vision',
    maxOutput: 24_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-23',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description: 'Latest multimodal model supporting image + text input to generate text.',
    displayName: 'Hunyuan Vision',
    id: 'hunyuan-vision',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 18, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-03',
    type: 'chat',
  },
  {
    contextWindowTokens: 8000,
    description:
      'Latest code generation model trained with 200B high-quality code and six months of SFT; context expanded to 8K. It ranks top in automated benchmarks for five languages and in human evaluations across ten criteria.',
    displayName: 'Hunyuan Code',
    id: 'hunyuan-code',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-11-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Latest MoE FunctionCall model trained with high-quality function-call data, featuring a 32K context window and leading benchmark results across dimensions.',
    displayName: 'Hunyuan FunctionCall',
    id: 'hunyuan-functioncall',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-22',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Latest roleplay model, officially fine-tuned on roleplay datasets, delivering stronger baseline performance for roleplay scenarios.',
    displayName: 'Hunyuan Role',
    id: 'hunyuan-role',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-07-04',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Latest roleplay model, officially fine-tuned on roleplay datasets, delivering stronger baseline performance for roleplay scenarios.',
    displayName: 'Hunyuan TurboS Role Plus',
    id: 'hunyuan-turbos-role-plus',
    maxOutput: 4000,
    type: 'chat',
  },
  // {
  //   contextWindowTokens: 8000,
  //   description:
  //     'The Hunyuan translation model supports conversational translation; it supports mutual translation among 15 languages, including Chinese, English, Japanese, French, Portuguese, Spanish, Turkish, Russian, Arabic, Korean, Italian, German, Vietnamese, Malay, and Indonesian.',
  //   displayName: 'Hunyuan Translation Lite',
  //   id: 'hunyuan-translation-lite',
  //   maxOutput: 4000,
  //   pricing: {
  //     currency: 'CNY',
  //     input: 1,
  //     output: 3,
  //   },
  //   releasedAt: '2024-11-25',
  //   type: 'chat',
  // },
  // {
  //   contextWindowTokens: 8000,
  //   description:
  //     'Supports mutual translation among 15 languages including Chinese, English, Japanese, French, Portuguese, Spanish, Turkish, Russian, Arabic, Korean, Italian, German, Vietnamese, Malay, and Indonesian. Based on automated COMET evaluation across multi-scenario translation benchmarks, it outperforms similarly sized models on translation between Chinese and other common languages.',
  //   displayName: 'Hunyuan Translation',
  //   id: 'hunyuan-translation',
  //   maxOutput: 4000,
  //   pricing: {
  //     currency: 'CNY',
  //     input: 15,
  //     output: 45,
  //   },
  //   releasedAt: '2024-10-25',
  //   type: 'chat',
  // },
];

export const allModels = [...hunyuanChatModels];

export default allModels;
