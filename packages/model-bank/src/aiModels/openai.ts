import type { ModelParamsSchema } from '../standard-parameters';
import type {
  AIChatModelCard,
  AIEmbeddingModelCard,
  AIImageModelCard,
  AIRealtimeModelCard,
  AISTTModelCard,
  AITTSModelCard,
} from '../types/aiModel';

export const gptImage1ParamsSchema: ModelParamsSchema = {
  imageUrls: { default: [] },
  prompt: { default: '' },
  size: {
    default: 'auto',
    enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
  },
};

export const openaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 is a flagship model for coding and agentic workflows with stronger reasoning and long-context performance.',
    displayName: 'GPT-5.2',
    enabled: true,
    id: 'gpt-5.2',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-11',
    settings: {
      extendParams: ['gpt5_2ReasoningEffort', 'textVerbosity'],
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
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 pro: a smarter, more precise GPT-5.2 variant (Responses API only), suited for hard problems and longer multi-turn reasoning.',
    displayName: 'GPT-5.2 pro',
    id: 'gpt-5.2-pro',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 168, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-11',
    settings: {
      extendParams: ['gpt5_2ProReasoningEffort'],
      searchImpl: 'params',
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
      'GPT-5.2 Chat is the ChatGPT variant (chat-latest) for the latest conversation improvements.',
    displayName: 'GPT-5.2 Chat',
    enabled: true,
    id: 'gpt-5.2-chat-latest',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-11',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 — a flagship model optimized for coding and agent tasks with configurable reasoning effort and longer context.',
    displayName: 'GPT-5.1',
    id: 'gpt-5.1',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      extendParams: ['gpt5_1ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-5.1 Chat: the ChatGPT variant of GPT-5.1, built for chat scenarios.',
    displayName: 'GPT-5.1 Chat',
    id: 'gpt-5.1-chat-latest',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 Codex: a GPT-5.1 variant optimized for agentic coding tasks, for complex code/agent workflows in the Responses API.',
    displayName: 'GPT-5.1 Codex',
    id: 'gpt-5.1-codex',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      extendParams: ['gpt5_1ReasoningEffort'],
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
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 Codex mini: a smaller, lower-cost Codex variant optimized for agentic coding tasks.',
    displayName: 'GPT-5.1 Codex mini',
    id: 'gpt-5.1-codex-mini',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      extendParams: ['gpt5_1ReasoningEffort'],
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
    contextWindowTokens: 400_000,
    description:
      'GPT-5 pro uses more compute to think deeper and consistently deliver better answers.',
    displayName: 'GPT-5 pro',
    id: 'gpt-5-pro',
    maxOutput: 272_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-06',
    settings: {
      extendParams: ['textVerbosity'],
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
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Codex is a GPT-5 variant optimized for agentic coding tasks in Codex-like environments.',
    displayName: 'GPT-5 Codex',
    id: 'gpt-5-codex',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'The best model for cross-domain coding and agent tasks. GPT-5 leaps in accuracy, speed, reasoning, context awareness, structured thinking, and problem solving.',
    displayName: 'GPT-5',
    id: 'gpt-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'A faster, more cost-efficient GPT-5 variant for well-defined tasks, delivering quicker responses while maintaining quality.',
    displayName: 'GPT-5 mini',
    enabled: true,
    id: 'gpt-5-mini',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'The fastest and most cost-effective GPT-5 variant, ideal for latency- and cost-sensitive applications.',
    displayName: 'GPT-5 nano',
    id: 'gpt-5-nano',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.005, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'The GPT-5 model used in ChatGPT, combining strong understanding and generation for conversational applications.',
    displayName: 'GPT-5 Chat',
    id: 'gpt-5-chat-latest',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
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
      'o4-mini is the latest small o-series model, optimized for fast, effective reasoning with high efficiency in coding and vision tasks.',
    displayName: 'o4-mini',
    id: 'o4-mini',
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
      'o4-mini-deep-research is a faster, more affordable deep research model for complex multi-step research. It can search the web and also access your data via MCP connectors.',
    displayName: 'o4-mini Deep Research',
    id: 'o4-mini-deep-research',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-26',
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
    id: 'o3-pro',
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
    id: 'o3',
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
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-deep-research is our most advanced deep research model for complex multi-step tasks. It can search the web and access your data via MCP connectors.',
    displayName: 'o3 Deep Research',
    id: 'o3-deep-research',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-26',
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
    id: 'o3-mini',
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
    id: 'o1-pro',
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
    id: 'o1',
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
    id: 'gpt-4.1',
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
    id: 'gpt-4.1-mini',
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
    id: 'gpt-4.1-nano',
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
    id: 'gpt-4o-mini',
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
      search: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini Search Preview is trained to understand and execute web search queries via the Chat Completions API. Web search is billed per tool call in addition to token costs.',
    displayName: 'GPT-4o mini Search Preview',
    id: 'gpt-4o-mini-search-preview',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-11',
    settings: {
      searchImpl: 'internal',
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
    id: 'gpt-4o',
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
      search: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o Search Preview is trained to understand and execute web search queries via the Chat Completions API. Web search is billed per tool call in addition to token costs.',
    displayName: 'GPT-4o Search Preview',
    id: 'gpt-4o-search-preview',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-11',
    settings: {
      searchImpl: 'internal',
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
    id: 'gpt-4o-2024-11-20',
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
    id: 'gpt-4o-2024-05-13',
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
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT Audio is a general chat model for audio input/output, supported in the Chat Completions API.',
    displayName: 'GPT Audio',
    id: 'gpt-audio',
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
      //search: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-4o Audio Preview model with audio input and output.',
    displayName: 'GPT-4o Audio Preview',
    id: 'gpt-4o-audio-preview',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    /*
    settings: {
      searchImpl: 'params',
    },
    */
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      //search: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-4o mini Audio model with audio input and output.',
    displayName: 'GPT-4o mini Audio',
    id: 'gpt-4o-mini-audio-preview',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    /*
    settings: {
      searchImpl: 'params',
    },
    */
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time, combining strong understanding and generation for large-scale use cases like customer support, education, and technical support.',
    displayName: 'ChatGPT-4o',
    id: 'chatgpt-4o-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-08-14',
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
    id: 'gpt-4-turbo',
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
    id: 'gpt-4-turbo-2024-04-09',
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
    contextWindowTokens: 128_000,
    description:
      'The latest GPT-4 Turbo adds vision. Visual requests support JSON mode and function calling. It is a cost-effective multimodal model that balances accuracy and efficiency for real-time applications.',
    displayName: 'GPT-4 Turbo Preview',
    id: 'gpt-4-turbo-preview',
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
    },
    contextWindowTokens: 128_000,
    description:
      'The latest GPT-4 Turbo adds vision. Visual requests support JSON mode and function calling. It is a cost-effective multimodal model that balances accuracy and efficiency for real-time applications.',
    displayName: 'GPT-4 Turbo Preview 0125',
    id: 'gpt-4-0125-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-01-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'The latest GPT-4 Turbo adds vision. Visual requests support JSON mode and function calling. It is a cost-effective multimodal model that balances accuracy and efficiency for real-time applications.',
    displayName: 'GPT-4 Turbo Preview 1106',
    id: 'gpt-4-1106-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-11-06',
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
    id: 'gpt-4',
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
    id: 'gpt-4-0613',
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
    id: 'gpt-3.5-turbo',
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
    id: 'gpt-3.5-turbo-0125',
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
    id: 'gpt-3.5-turbo-1106',
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
    id: 'gpt-3.5-turbo-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'codex-mini-latest is a fine-tuned o4-mini model for the Codex CLI. For direct API use, we recommend starting with gpt-4.1.',
    displayName: 'Codex mini',
    id: 'codex-mini-latest',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-01',
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
    contextWindowTokens: 8192,
    description:
      'computer-use-preview is a specialized model for the "computer use tool," trained to understand and execute computer-related tasks.',
    displayName: 'Computer Use Preview',
    id: 'computer-use-preview',
    maxOutput: 1024,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-11',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];

export const openaiEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    contextWindowTokens: 8192,
    description: 'The most capable embedding model for English and non-English tasks.',
    displayName: 'Text Embedding 3 Large',
    id: 'text-embedding-3-large',
    maxDimension: 3072,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2024-01-25',
    type: 'embedding',
  },
  {
    contextWindowTokens: 8192,
    description:
      'An efficient, cost-effective next-generation embedding model for retrieval and RAG scenarios.',
    displayName: 'Text Embedding 3 Small',
    id: 'text-embedding-3-small',
    maxDimension: 1536,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2024-01-25',
    type: 'embedding',
  },
];

// Text-to-speech models
export const openaiTTSModels: AITTSModelCard[] = [
  {
    description: 'The latest text-to-speech model optimized for real-time speed.',
    displayName: 'TTS-1',
    id: 'tts-1',
    pricing: {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
  },
  {
    description: 'The latest text-to-speech model optimized for quality.',
    displayName: 'TTS-1 HD',
    id: 'tts-1-hd',
    pricing: {
      units: [{ name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
  },
  {
    description:
      'GPT-4o mini TTS is a text-to-speech model built on GPT-4o mini, converting text into natural-sounding speech with a max input of 2000 tokens.',
    displayName: 'GPT-4o Mini TTS',
    id: 'gpt-4o-mini-tts',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'tts',
  },
];

// Speech recognition models
export const openaiSTTModels: AISTTModelCard[] = [
  {
    description:
      'A general speech recognition model supporting multilingual ASR, speech translation, and language identification.',
    displayName: 'Whisper',
    id: 'whisper-1',
    pricing: {
      units: [
        {
          name: 'audioInput',
          rate: 0.0001, // $0.006 per minute => $0.0001 per second
          strategy: 'fixed',
          unit: 'second',
        },
      ],
    },
    type: 'stt',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'GPT-4o Transcribe is a speech-to-text model that transcribes audio with GPT-4o, improving word error rate, language ID, and accuracy over the original Whisper model.',
    displayName: 'GPT-4o Transcribe',
    id: 'gpt-4o-transcribe',
    maxOutput: 2000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'stt',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'GPT-4o Mini Transcribe is a speech-to-text model that transcribes audio with GPT-4o, improving word error rate, language ID, and accuracy over the original Whisper model.',
    displayName: 'GPT-4o Mini Transcribe',
    id: 'gpt-4o-mini-transcribe',
    maxOutput: 2000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'stt',
  },
];

// Image generation models
export const openaiImageModels: AIImageModelCard[] = [
  {
    description:
      'An enhanced GPT Image 1 model with 4× faster generation, more precise editing, and improved text rendering.',
    displayName: 'GPT Image 1.5',
    enabled: true,
    id: 'gpt-image-1.5',
    parameters: gptImage1ParamsSchema,
    pricing: {
      approximatePricePerImage: 0.034,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-16',
    type: 'image',
  },
  // https://platform.openai.com/docs/models/gpt-image-1
  {
    description: 'ChatGPT native multimodal image generation model.',
    displayName: 'GPT Image 1',
    enabled: true,
    id: 'gpt-image-1',
    parameters: gptImage1ParamsSchema,
    pricing: {
      approximatePricePerImage: 0.042,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'image',
  },
  {
    description:
      'A lower-cost GPT Image 1 variant with native text and image input and image output.',
    displayName: 'GPT Image 1 Mini',
    enabled: true,
    id: 'gpt-image-1-mini',
    parameters: gptImage1ParamsSchema,
    pricing: {
      approximatePricePerImage: 0.011,
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-06',
    type: 'image',
  },
  {
    description:
      'The latest DALL·E model, released in November 2023, supports more realistic, accurate image generation with stronger detail.',
    displayName: 'DALL·E 3',
    enabled: true,
    id: 'dall-e-3',
    parameters: {
      prompt: { default: '' },
      quality: {
        default: 'standard',
        enum: ['standard', 'hd'],
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '1792x1024', '1024x1792'],
      },
    },
    pricing: {
      units: [
        {
          lookup: {
            prices: {
              hd_1024x1024: 0.08,
              hd_1024x1792: 0.12,
              hd_1792x1024: 0.12,
              standard_1024x1024: 0.04,
              standard_1024x1792: 0.08,
              standard_1792x1024: 0.08,
            },
            pricingParams: ['quality', 'size'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    },
    type: 'image',
  },
  {
    description:
      'Second-generation DALL·E model with more realistic, accurate image generation and 4× the resolution of the first generation.',
    displayName: 'DALL·E 2',
    id: 'dall-e-2',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
      size: {
        default: '1024x1024',
        enum: ['256x256', '512x512', '1024x1024'],
      },
    },
    pricing: {
      units: [
        {
          lookup: {
            prices: {
              '1024x1024': 0.02,
              '256x256': 0.016,
              '512x512': 0.018,
            },
            pricingParams: ['size'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    },
    type: 'image',
  },
];

// GPT-4o and GPT-4o-mini realtime models
export const openaiRealtimeModels: AIRealtimeModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'A general real-time model supporting real-time text and audio I/O, plus image input.',
    displayName: 'GPT Realtime',
    id: 'gpt-realtime',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 64, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },

        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },

        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-28',
    type: 'realtime',
  },
  {
    contextWindowTokens: 16_000,
    description: 'GPT-4o realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Realtime 241217',
    id: 'gpt-4o-realtime-preview',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    type: 'realtime',
  },
  {
    contextWindowTokens: 32_000,
    description: 'GPT-4o realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Realtime 250603',
    id: 'gpt-4o-realtime-preview-2025-06-03',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-03',
    type: 'realtime',
  },
  {
    contextWindowTokens: 16_000,
    description: 'GPT-4o realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Realtime 241001',
    id: 'gpt-4o-realtime-preview-2024-10-01', // deprecated on 2025-10-10
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 200, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-01',
    type: 'realtime',
  },
  {
    contextWindowTokens: 128_000,
    description: 'GPT-4o-mini realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Mini Realtime',
    id: 'gpt-4o-mini-realtime-preview',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    type: 'realtime',
  },
];

export const allModels = [
  ...openaiChatModels,
  ...openaiEmbeddingModels,
  ...openaiTTSModels,
  ...openaiSTTModels,
  ...openaiImageModels,
  ...openaiRealtimeModels,
];

export default allModels;
