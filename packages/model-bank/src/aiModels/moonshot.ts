import type { AIChatModelCard } from '../types/aiModel';

// https://platform.moonshot.cn/docs/pricing/chat
const moonshotChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 is Kimi\'s most versatile model to date, featuring a native multimodal architecture that supports both vision and text inputs, "thinking" and "non-thinking" modes, and both conversational and agent tasks.',
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'K2 long-thinking model with 256k context, supporting multi-step tool use and reasoning for complex problems.',
    displayName: 'Kimi K2 Thinking',
    id: 'kimi-k2-thinking',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'High-speed K2 long-thinking variant with 256k context, strong deep reasoning, and 60–100 tokens/sec output.',
    displayName: 'Kimi K2 Thinking Turbo',
    id: 'kimi-k2-thinking-turbo',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 58, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'kimi-k2-0905-preview offers a 256k context window, stronger agentic coding, better front-end code quality, and improved context understanding.',
    displayName: 'Kimi K2 0905',
    id: 'kimi-k2-0905-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'kimi-k2 is an MoE foundation model with strong coding and agent capabilities (1T total params, 32B active), outperforming other mainstream open models across reasoning, programming, math, and agent benchmarks.',
    displayName: 'Kimi K2 0711',
    id: 'kimi-k2-0711-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-11',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'kimi-k2 is an MoE foundation model with strong coding and agent capabilities (1T total params, 32B active), outperforming other mainstream open models across reasoning, programming, math, and agent benchmarks.',
    displayName: 'Kimi K2 0905 Turbo',
    id: 'kimi-k2-turbo-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 58, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Kimi Latest uses the newest Kimi model and may include experimental features. It supports image understanding and automatically selects 8k/32k/128k billing models based on context length.',
    displayName: 'Kimi Latest',
    enabled: true,
    id: 'kimi-latest',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: {
            prices: {
              '[0, 0.008_192]': 2,
              '[0.008_193, 0.032_768]': 5,
              '[0.032_769, 0.131_072]': 10,
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
              '[0, 0.008_192]': 10,
              '[0.008_193, 0.032_768]': 20,
              '[0.032_769, 0.131_072]': 30,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-02-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Moonshot V1 Auto selects the appropriate model based on current context token usage.',
    displayName: 'Moonshot V1 Auto',
    id: 'moonshot-v1-auto',
    pricing: {
      currency: 'CNY',
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
    },
    contextWindowTokens: 8192,
    description:
      'Moonshot V1 8K is optimized for short text generation with efficient performance, handling 8,192 tokens for short chats, notes, and quick content.',
    displayName: 'Moonshot V1 8K',
    id: 'moonshot-v1-8k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Moonshot V1 32K supports 32,768 tokens for medium-length context, ideal for long documents and complex dialogues in content creation, reports, and chat systems.',
    displayName: 'Moonshot V1 32K',
    id: 'moonshot-v1-32k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Moonshot V1 128K provides ultra-long context for very long text generation, handling up to 128,000 tokens for research, academic, and large-document scenarios.',
    displayName: 'Moonshot V1 128K',
    id: 'moonshot-v1-128k',
    pricing: {
      currency: 'CNY',
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
    contextWindowTokens: 8192,
    description:
      'Kimi vision models (including moonshot-v1-8k-vision-preview/moonshot-v1-32k-vision-preview/moonshot-v1-128k-vision-preview) can understand image content such as text, colors, and object shapes.',
    displayName: 'Moonshot V1 8K Vision Preview',
    id: 'moonshot-v1-8k-vision-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Kimi vision models (including moonshot-v1-8k-vision-preview/moonshot-v1-32k-vision-preview/moonshot-v1-128k-vision-preview) can understand image content such as text, colors, and object shapes.',
    displayName: 'Moonshot V1 32K Vision Preview',
    id: 'moonshot-v1-32k-vision-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Kimi vision models (including moonshot-v1-8k-vision-preview/moonshot-v1-32k-vision-preview/moonshot-v1-128k-vision-preview) can understand image content such as text, colors, and object shapes.',
    displayName: 'Moonshot V1 128K Vision Preview',
    id: 'moonshot-v1-128k-vision-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-14',
    type: 'chat',
  },
];

export const allModels = [...moonshotChatModels];

export default allModels;
