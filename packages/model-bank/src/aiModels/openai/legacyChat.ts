import type { AIChatModelCard } from '../../types/aiModel';

/** Chat models released before GPT-5: the o-series, GPT-4.x, gpt-audio and GPT-3.5. */
export const openaiLegacyChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o4-mini is the latest small o-series model, optimized for fast, effective reasoning with high efficiency in coding and vision tasks.',
    displayName: 'o4-mini',
    family: 'o-series',
    generation: 'o4',
    id: 'o4-mini',
    isOfficial: true,
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    settings: {
      extendParams: ['reasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-pro uses more compute to think deeper and consistently deliver better answers; available only via the Responses API.',
    displayName: 'o3-pro',
    family: 'o-series',
    generation: 'o3',
    id: 'o3-pro',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-10',
    settings: {
      extendParams: ['reasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3 is a powerful all-round model that sets a new bar for math, science, programming, and visual reasoning. It excels at technical writing and instruction following and can analyze text, code, and images for multi-step problems.',
    displayName: 'o3',
    family: 'o-series',
    generation: 'o3',
    id: 'o3',
    isOfficial: true,
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-16',
    settings: {
      extendParams: ['reasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini is our latest small reasoning model, delivering higher intelligence at the same cost and latency targets as o1-mini.',
    displayName: 'o3-mini',
    family: 'o-series',
    generation: 'o3',
    id: 'o3-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-31',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'The o1 series is trained with reinforcement learning to think before answering and handle complex reasoning. o1-pro uses more compute for deeper thinking and consistently higher-quality answers.',
    displayName: 'o1-pro',
    family: 'o-series',
    generation: 'o1',
    id: 'o1-pro',
    knowledgeCutoff: '2023-10',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 150, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 600, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-19',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o1 is OpenAI’s new reasoning model with text+image input and text output, suited for complex tasks requiring broad knowledge. It has a 200K context window and an October 2023 knowledge cutoff.',
    displayName: 'o1',
    family: 'o-series',
    generation: 'o1',
    id: 'o1',
    knowledgeCutoff: '2023-10',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 is our flagship model for complex tasks and cross-domain problem solving.',
    displayName: 'GPT-4.1',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1',
    isOfficial: true,
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 mini balances intelligence, speed, and cost, making it attractive for many use cases.',
    displayName: 'GPT-4.1 mini',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-mini',
    isOfficial: true,
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 nano is the fastest and most cost-effective GPT-4.1 model.',
    displayName: 'GPT-4.1 nano',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-nano',
    isOfficial: true,
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini is OpenAI’s latest model after GPT-4 Omni, supporting text+image input with text output. It is their most advanced small model, far cheaper than recent frontier models and over 60% cheaper than GPT-3.5 Turbo, while maintaining top-tier intelligence (82% MMLU).',
    displayName: 'GPT-4o mini',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-mini',
    isOfficial: true,
    knowledgeCutoff: '2023-10',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-07-18',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time, combining strong understanding and generation for large-scale use cases like customer support, education, and technical support.',
    displayName: 'GPT-4o',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o',
    isOfficial: true,
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-05-13',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time, combining strong understanding and generation for large-scale use cases like customer support, education, and technical support.',
    displayName: 'GPT-4o 1120',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-2024-11-20',
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-11-20',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time, combining strong understanding and generation for large-scale use cases like customer support, education, and technical support.',
    displayName: 'GPT-4o 0513',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-2024-05-13',
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-05-13',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT Audio is a general chat model for audio input/output, supported in the Chat Completions API.',
    displayName: 'GPT Audio',
    family: 'gpt',
    generation: 'gpt-audio',
    id: 'gpt-audio',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },

        { name: 'audioInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'The latest GPT-4 Turbo adds vision. Visual requests support JSON mode and function calling. It is a cost-effective multimodal model that balances accuracy and efficiency for real-time applications.',
    displayName: 'GPT-4 Turbo',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4-turbo',
    isOfficial: true,
    knowledgeCutoff: '2023-12',
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'The latest GPT-4 Turbo adds vision. Visual requests support JSON mode and function calling. It is a cost-effective multimodal model that balances accuracy and efficiency for real-time applications.',
    displayName: 'GPT-4 Turbo Vision 0409',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4-turbo-2024-04-09',
    knowledgeCutoff: '2023-12',
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-04-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      'GPT-4 provides a larger context window to handle longer inputs, suitable for broad information synthesis and data analysis.',
    displayName: 'GPT-4',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      'GPT-4 provides a larger context window to handle longer inputs, suitable for broad information synthesis and data analysis.',
    displayName: 'GPT-4 0613',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4-0613',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-06-13',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_384,
    description:
      'GPT 3.5 Turbo for text generation and understanding; currently points to gpt-3.5-turbo-0125.',
    displayName: 'GPT-3.5 Turbo',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_384,
    description:
      'GPT 3.5 Turbo for text generation and understanding; currently points to gpt-3.5-turbo-0125.',
    displayName: 'GPT-3.5 Turbo 0125',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo-0125',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-01-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_384,
    description:
      'GPT 3.5 Turbo for text generation and understanding; currently points to gpt-3.5-turbo-0125.',
    displayName: 'GPT-3.5 Turbo 1106',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo-1106',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-11-06',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'GPT 3.5 Turbo for text generation and understanding tasks, optimized for instruction following.',
    displayName: 'GPT-3.5 Turbo Instruct',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo-instruct',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];
