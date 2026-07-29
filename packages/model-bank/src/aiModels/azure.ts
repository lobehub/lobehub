import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

const azureChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5.4',
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.4 is the frontier model for complex professional work with highest reasoning capability.',
    displayName: 'GPT-5.4',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2.5, upTo: 272_000 },
            { rate: 5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.25, upTo: 272_000 },
            { rate: 0.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 15, upTo: 272_000 },
            { rate: 22.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-05',
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
    config: {
      deploymentName: 'gpt-5.4-pro',
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.4 Pro uses more compute to think harder and provide consistently better answers, available in the Responses API only.',
    displayName: 'GPT-5.4 Pro',
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-pro',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 30, upTo: 272_000 },
            { rate: 60, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 180, upTo: 272_000 },
            { rate: 270, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-05',
    settings: {
      extendParams: ['gpt5_2ProReasoningEffort', 'textVerbosity'],
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
    config: {
      deploymentName: 'gpt-5.4-mini',
    },
    contextWindowTokens: 400_000,
    description:
      "GPT-5.4 mini is OpenAI's strongest mini model for coding, computer use, and subagents.",
    displayName: 'GPT-5.4 mini',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-mini',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
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
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5.4-nano',
    },
    contextWindowTokens: 400_000,
    description:
      "GPT-5.4 nano is OpenAI's cheapest GPT-5.4-class model for simple high-volume tasks.",
    displayName: 'GPT-5.4 nano',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-nano',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
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
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5.2',
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 is a flagship model for coding and agentic workflows with stronger reasoning and long-context performance.',
    displayName: 'GPT-5.2',
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2',
    knowledgeCutoff: '2025-08',
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
    config: {
      deploymentName: 'gpt-5.1',
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 is a flagship model optimized for coding and agent tasks with configurable reasoning effort and longer context.',
    displayName: 'GPT-5.1',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1',
    knowledgeCutoff: '2024-09',
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5-pro',
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Pro is the advanced version in the GPT-5 series with enhanced reasoning. It supports structured output, function calling, and text/image processing, making it ideal for complex professional tasks.',
    displayName: 'GPT-5 Pro',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-pro',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    config: {
      deploymentName: 'gpt-5-codex',
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Codex is optimized for programming tasks, including Codex CLI and the VS Code extension. It supports structured output and function calling for code generation and analysis.',
    displayName: 'GPT-5 Codex',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-codex',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-11',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5',
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 is OpenAI’s latest flagship model with exceptional reasoning. It supports text and image input, structured output, and parallel tool calls, suitable for complex tasks requiring deep understanding and analysis.',
    displayName: 'GPT-5',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5',
    knowledgeCutoff: '2024-09',
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
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5-mini',
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Mini offers capabilities similar to GPT-5 but is more efficient and cost-effective. It supports reasoning, function calling, and vision, making it suitable for large-scale deployment and cost-sensitive use cases.',
    displayName: 'GPT-5 Mini',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-mini',
    knowledgeCutoff: '2024-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5-nano',
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Nano is the smallest and fastest GPT-5 variant. It retains core capabilities while delivering ultra-low latency and cost efficiency, ideal for edge computing and real-time applications.',
    displayName: 'GPT-5 Nano',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-nano',
    knowledgeCutoff: '2024-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.005, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    config: {
      deploymentName: 'gpt-5-chat',
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-5 Chat is a preview model optimized for conversational scenarios. It supports text and image input, outputs text only, and fits chatbots and conversational AI applications.',
    displayName: 'GPT-5 Chat',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-chat',
    knowledgeCutoff: '2024-09',
    maxOutput: 16_384,
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
      vision: true,
    },
    config: {
      deploymentName: 'o3',
    },
    contextWindowTokens: 200_000,
    description:
      'o3 is a versatile, powerful model that excels across domains, setting a new bar for math, science, coding, and visual reasoning. It is also strong in technical writing and instruction following, and can analyze text, code, and images to solve multi-step problems.',
    displayName: 'o3',
    enabled: true,
    family: 'o-series',
    generation: 'o3',
    id: 'o3',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
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
    config: {
      deploymentName: 'o4-mini',
    },
    contextWindowTokens: 200_000,
    description:
      'o4-mini is our latest small o-series model, optimized for fast, efficient reasoning and high performance in coding and vision tasks.',
    displayName: 'o4-mini',
    enabled: true,
    family: 'o-series',
    generation: 'o4',
    id: 'o4-mini',
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
      structuredOutput: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-4.1',
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 is our flagship model for complex tasks and cross-domain problem solving.',
    displayName: 'GPT-4.1',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1',
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
    config: {
      deploymentName: 'gpt-4.1-mini',
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 mini balances intelligence, speed, and cost, making it an attractive model for many use cases.',
    displayName: 'GPT-4.1 mini',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-mini',
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
    config: {
      deploymentName: 'gpt-4.1-nano',
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 mini balances intelligence, speed, and cost, making it an attractive model for many use cases.',
    displayName: 'GPT-4.1 nano',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-nano',
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
    config: {
      deploymentName: 'o3-mini',
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini is our latest small reasoning model, delivering high intelligence at the same cost and latency targets as o1-mini.',
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
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    config: {
      deploymentName: 'o1-mini',
    },
    contextWindowTokens: 128_000,
    description:
      'o1-mini is a fast, cost-effective reasoning model designed for programming, math, and science use cases. It has a 128K context window and an October 2023 knowledge cutoff.',
    displayName: 'o1-mini',
    family: 'o-series',
    generation: 'o1',
    id: 'o1-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    config: {
      deploymentName: 'o1',
    },
    contextWindowTokens: 200_000,
    description:
      'o1 is OpenAI’s new reasoning model that supports text and image input and outputs text, suitable for complex tasks requiring broad general knowledge. It has a 200K context window and an October 2023 knowledge cutoff.',
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
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    config: {
      deploymentName: 'o1-preview',
    },
    contextWindowTokens: 128_000,
    description:
      'o1 is OpenAI’s new reasoning model for complex tasks requiring broad general knowledge. It has a 128K context window and an October 2023 knowledge cutoff.',
    displayName: 'o1-preview',
    family: 'o-series',
    generation: 'o1',
    id: 'o1-preview',
    knowledgeCutoff: '2023-10',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-4o',
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model that updates in real time to stay current. It combines strong language understanding and generation, suitable for large-scale applications such as customer support, education, and technical support.',
    displayName: 'GPT-4o',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o',
    knowledgeCutoff: '2023-10',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-05-13',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-4-turbo',
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4 Turbo is a multimodal model with strong understanding and generation, supporting image input.',
    displayName: 'GPT 4 Turbo',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4',
    knowledgeCutoff: '2021-09',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    config: {
      deploymentName: 'gpt-4o-mini',
    },
    contextWindowTokens: 128_000,
    description: 'GPT-4o Mini is a small, efficient model with performance similar to GPT-4o.',
    displayName: 'GPT 4o Mini',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const azureImageModels: AIImageModelCard[] = [
  {
    description: 'ChatGPT Image 1',
    displayName: 'GPT Image 1',
    enabled: true,
    id: 'gpt-image-1',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
      size: {
        default: 'auto',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
      },
    },
    type: 'image',
  },
  {
    description: 'DALL·E 3',
    displayName: 'DALL·E 3',
    id: 'dall-e-3',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
      size: {
        default: 'auto',
        enum: ['auto', '1024x1024', '1792x1024', '1024x1792'],
      },
    },
    type: 'image',
  },
  {
    description: 'FLUX.1 Kontext [pro]',
    displayName: 'FLUX.1 Kontext [pro]',
    enabled: true,
    id: 'FLUX.1-Kontext-pro',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
      size: {
        default: 'auto',
        enum: ['auto', '1024x1024', '1792x1024', '1024x1792'],
      },
    },
    releasedAt: '2025-06-23',
    type: 'image',
  },
  {
    description: 'FLUX.1.1 Pro',
    displayName: 'FLUX.1.1 Pro',
    enabled: true,
    id: 'FLUX-1.1-pro',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
    },
    releasedAt: '2025-06-23',
    type: 'image',
  },
];

export const allModels = [...azureChatModels, ...azureImageModels];

export default allModels;
