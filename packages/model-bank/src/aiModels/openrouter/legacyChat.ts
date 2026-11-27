import type { AIChatModelCard } from '../../types/aiModel';

/** Older chat models, kept after the current ones in their original display order. */
export const openrouterLegacyChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3 is a powerful general-purpose model that excels across domains. It sets a new bar for math, science, coding, and vision reasoning, and is strong at technical writing and instruction following. Use it to analyze text, code, and images and solve complex multi-step problems.',
    displayName: 'o3',
    family: 'o-series',
    generation: 'o3',
    id: 'openai/o3',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
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
      'o4-mini high reasoning tier, optimized for fast, efficient reasoning with strong coding and vision performance.',
    displayName: 'o4-mini (high)',
    family: 'o-series',
    generation: 'o4',
    id: 'openai/o4-mini-high',
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
      'o4-mini is optimized for fast, effective reasoning with strong efficiency and performance in coding and vision tasks.',
    displayName: 'o4-mini',
    family: 'o-series',
    generation: 'o4',
    id: 'openai/o4-mini',
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
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 is the flagship model for complex tasks and cross-domain problem solving.',
    displayName: 'GPT-4.1',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'openai/gpt-4.1',
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
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 mini balances intelligence, speed, and cost for many use cases.',
    displayName: 'GPT-4.1 mini',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'openai/gpt-4.1-mini',
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
    id: 'openai/gpt-4.1-nano',
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
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini (high reasoning) delivers higher intelligence at the same cost and latency targets as o1-mini.',
    displayName: 'o3-mini (high)',
    family: 'o-series',
    generation: 'o3',
    id: 'openai/o3-mini-high',
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
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini delivers higher intelligence at the same cost and latency targets as o1-mini.',
    displayName: 'o3-mini',
    family: 'o-series',
    generation: 'o3',
    id: 'openai/o3-mini',
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
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini is OpenAI’s latest model after GPT-4 Omni, supporting image+text input with text output. As their most advanced small model, it is far cheaper than recent frontier models and over 60% cheaper than GPT-3.5 Turbo, while retaining top-tier intelligence. It scores 82% on MMLU and ranks above GPT-4 in chat preference.',
    displayName: 'GPT-4o mini',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'openai/gpt-4o-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_385,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
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
      'ChatGPT-4o is a dynamic model updated in real time. It combines strong language understanding and generation for large-scale use cases like customer support, education, and technical assistance.',
    displayName: 'GPT-4o',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'openai/gpt-4o',
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 greatly improves reasoning with minimal labeled data and outputs a chain-of-thought before the final answer to improve accuracy.',
    displayName: 'DeepSeek R1 0528',
    family: 'deepseek',
    generation: 'deepseek-r1',
    id: 'deepseek/deepseek-r1-0528',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-28',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 greatly improves reasoning with minimal labeled data and outputs a chain-of-thought before the final answer to improve accuracy.',
    displayName: 'DeepSeek R1',
    family: 'deepseek',
    generation: 'deepseek-r1',
    id: 'deepseek/deepseek-r1',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-20',
    type: 'chat',
  },
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3 is a 685B-parameter MoE model and the latest iteration of DeepSeek’s flagship chat series.\n\nIt builds on [DeepSeek V3](/deepseek/deepseek-chat-v3) and performs strongly across tasks.',
    displayName: 'DeepSeek V3 0324',
    family: 'deepseek',
    generation: 'deepseek-v3',
    id: 'deepseek/deepseek-chat-v3-0324',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Claude Opus 4.5 is Anthropic’s flagship model, combining top-tier intelligence with scalable performance for complex, high-quality reasoning tasks.',
    displayName: 'Claude Opus 4.5',
    family: 'claude-opus',
    generation: 'claude-4.5',
    id: 'anthropic/claude-opus-4.5',
    knowledgeCutoff: '2025-05',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-24',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
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
    description: 'Claude Sonnet 4.5 is Anthropic’s most intelligent model to date.',
    displayName: 'Claude Sonnet 4.5',
    family: 'claude-sonnet',
    generation: 'claude-4.5',
    id: 'anthropic/claude-sonnet-4.5',
    knowledgeCutoff: '2025-01',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-30',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Haiku is Anthropic’s fastest and most compact model, designed for near-instant responses with fast, accurate performance.',
    displayName: 'Claude 3 Haiku',
    family: 'claude-haiku',
    generation: 'claude-3',
    id: 'anthropic/claude-3-haiku',
    knowledgeCutoff: '2023-08',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 0.3125 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-03-07',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Haiku is Anthropic’s fastest next-gen model. Compared to Claude 3 Haiku, it improves across skills and surpasses the previous largest model Claude 3 Opus on many intelligence benchmarks.',
    displayName: 'Claude 3.5 Haiku',
    family: 'claude-haiku',
    generation: 'claude-3.5',
    id: 'anthropic/claude-3.5-haiku',
    knowledgeCutoff: '2024-07',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 1.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-11-05',
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
      'Claude 3.7 Sonnet is Anthropic’s most intelligent model and the first hybrid reasoning model on the market. It can produce near-instant responses or extended step-by-step reasoning that users can see. Sonnet is especially strong at coding, data science, vision, and agent tasks.',
    displayName: 'Claude 3.7 Sonnet',
    family: 'claude-sonnet',
    generation: 'claude-3.7',
    id: 'anthropic/claude-3.7-sonnet',
    knowledgeCutoff: '2024-10',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-02-24',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'Claude Sonnet 4 can produce near-instant responses or extended step-by-step reasoning that users can see. API users can finely control how long the model thinks.',
    displayName: 'Claude Sonnet 4',
    family: 'claude-sonnet',
    generation: 'claude-4',
    id: 'anthropic/claude-sonnet-4',
    knowledgeCutoff: '2025-01',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'Claude Opus 4 is Anthropic’s most powerful model for highly complex tasks, excelling in performance, intelligence, fluency, and comprehension.',
    displayName: 'Claude Opus 4',
    family: 'claude-opus',
    generation: 'claude-4',
    id: 'anthropic/claude-opus-4',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description:
      'Gemini 2.0 Flash delivers next-gen capabilities, including excellent speed, native tool use, multimodal generation, and a 1M-token context window.',
    displayName: 'Gemini 2.0 Flash',
    family: 'gemini',
    generation: 'gemini-2.0',
    id: 'google/gemini-2.0-flash-001',
    knowledgeCutoff: '2024-08',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 is designed for tasks combining vision and text. It excels at image captioning and visual QA, bridging language generation and visual reasoning.',
    displayName: 'Llama 3.2 11B Vision',
    family: 'llama',
    generation: 'llama-3.2',
    id: 'meta-llama/llama-3.2-11b-vision-instruct',
    knowledgeCutoff: '2023-12',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.162, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.162, strategy: 'fixed', unit: 'millionTokens' },
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
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost. It is Transformer-based and improved with SFT and RLHF for usefulness and safety. The instruction-tuned version is optimized for multilingual chat and beats many open and closed chat models on industry benchmarks. Knowledge cutoff: Dec 2023.',
    displayName: 'Llama 3.3 70B Instruct',
    family: 'llama',
    generation: 'llama-3.3',
    id: 'meta-llama/llama-3.3-70b-instruct',
    knowledgeCutoff: '2023-12',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost. It is Transformer-based and improved with SFT and RLHF for usefulness and safety. The instruction-tuned version is optimized for multilingual chat and beats many open and closed chat models on industry benchmarks. Knowledge cutoff: Dec 2023.',
    displayName: 'Llama 3.3 70B Instruct (Free)',
    family: 'llama',
    generation: 'llama-3.3',
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
];
