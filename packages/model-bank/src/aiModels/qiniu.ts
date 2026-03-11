import type { AIChatModelCard } from '../types/aiModel';

// https://developer.qiniu.com/aitokenapi

const qiniuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Greatly improved reasoning speed, leading open models and comparable to top closed models. Uses load-balancing strategies and multi-token prediction training for significant gains.',
    displayName: 'DeepSeek V3',
    enabled: true,
    id: 'deepseek-v3',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek R1 is DeepSeek’s latest open model with very strong reasoning, matching OpenAI’s o1 on math, programming, and reasoning tasks.',
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek-r1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2.1 is a lightweight, cutting-edge large language model optimized for coding, proxy workflows, and modern application development, providing cleaner, more concise output and faster perceptual response times.',
    displayName: 'MiniMax M2.1',
    enabled: true,
    id: 'minimax/minimax-m2.1',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-24',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 204_800,
    description: 'Built for efficient coding and agent workflows.',
    displayName: 'MiniMax M2',
    enabled: true,
    id: 'minimax/minimax-m2',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-27',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek Math V2 is a model that has made significant breakthroughs in mathematical reasoning capabilities. Its core innovation lies in the "self-verification" training mechanism, and it has achieved gold medal levels in several top mathematics competitions.',
    displayName: 'DeepSeek Math V2',
    enabled: true,
    id: 'deepseek/deepseek-math-v2',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-27',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'An open-source non-thinking base model from Meituan optimized for dialogue and agent tasks, strong in tool use and complex multi-turn interactions.',
    displayName: 'LongCat Flash Chat',
    enabled: true,
    id: 'meituan/longcat-flash-chat',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-01',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM-4.7 is Zhipu's latest flagship model, offering improved general capabilities, simpler and more natural replies, and a more immersive writing experience.",
    displayName: 'GLM-4.7',
    enabled: true,
    id: 'z-ai/glm-4.7',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.168, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.528, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-23',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      'The flagship model of Zhipu, GLM-4.6, surpasses its predecessor in all aspects of advanced coding, long text processing, reasoning, and intelligent agent capabilities.',
    displayName: 'GLM-4.6',
    enabled: true,
    id: 'z-ai/glm-4.6',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 7.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-30',
    settings: {
      extendParams: ['enableReasoning'],
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
    contextWindowTokens: 2_000_000,
    description:
      'We’re excited to release Grok 4 Fast, our latest progress in cost-effective reasoning models.',
    displayName: 'Grok 4 Fast',
    enabled: true,
    id: 'x-ai/grok-4-fast',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 7.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-09',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'We’re excited to launch grok-code-fast-1, a fast and cost-effective reasoning model that excels at agentic coding.',
    displayName: 'Grok Code Fast 1',
    id: 'x-ai/grok-code-fast-1',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-27',
    // settings: {
    // reasoning_effort is not supported by grok-code. Specifying reasoning_effort parameter will get an error response.
    // extendParams: ['reasoningEffort'],
    // },
    type: 'chat',
  },
];

export const allModels = [...qiniuChatModels];

export default allModels;
