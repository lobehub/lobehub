import type { AIChatModelCard } from '../../types/aiModel';

/** Older chat models, kept after the current ones in their original display order. */
export const zenmuxLegacyChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Opus 4.1 is Anthropic’s high-end model optimized for programming, complex reasoning, and long-running tasks.',
    displayName: 'Claude Opus 4.1',
    family: 'claude-opus',
    generation: 'claude-4.1',
    id: 'anthropic/claude-opus-4.1',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'Opus 4 is Anthropic’s flagship model designed for complex tasks and enterprise applications.',
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
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Gemini 2.5 Flash Image (Nano Banana) is Google’s image generation model with multimodal conversation support.',
    displayName: 'Gemini 2.5 Flash Image (Nano Banana)',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'google/gemini-2.5-flash-image',
    knowledgeCutoff: '2025-06',
    maxOutput: 8192,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Claude Sonnet 4.5 is Anthropic’s latest hybrid reasoning model optimized for complex reasoning and coding.',
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
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Sonnet 4 is Anthropic’s hybrid reasoning model with mixed thinking and non-thinking capability.',
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
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description: 'OpenAI o4-mini is a small, efficient reasoning model for low-latency scenarios.',
    displayName: 'o4 Mini',
    family: 'o-series',
    generation: 'o4',
    id: 'openai/o4-mini',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      reasoningEffort: { levels: ['low', 'medium', 'high'] },
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'The GPT-4o family is OpenAI’s Omni model with text + image input and text output.',
    displayName: 'GPT-4o',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'openai/gpt-4o',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_380,
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
    contextWindowTokens: 128_000,
    description: 'GPT-4o-mini is a fast, small GPT-4o variant for low-latency multimodal use.',
    displayName: 'GPT-4o-mini',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'openai/gpt-4o-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_380,
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
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Kimi K2 0711 is the instruct variant in the Kimi series, suited for high-quality code and tool use.',
    displayName: 'Kimi K2 0711',
    family: 'kimi',
    generation: 'kimi-k2',
    id: 'moonshotai/kimi-k2-0711',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.23, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GLM 4.5 Air is a lightweight GLM 4.5 variant for cost-sensitive scenarios while retaining strong reasoning.',
    displayName: 'GLM 4.5 Air',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'z-ai/glm-4.5-air',
    maxOutput: 96_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Claude 3.5 Haiku features enhanced speed, coding accuracy, and tool use, suitable for scenarios with demanding requirements for speed and tool interaction.',
    displayName: 'Claude 3.5 Haiku',
    family: 'claude-haiku',
    generation: 'claude-3.5',
    id: 'anthropic/claude-3.5-haiku',
    knowledgeCutoff: '2024-07',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Claude 3.5 Sonnet is the fast, efficient model in the Sonnet family, offering better coding and reasoning performance, with some versions gradually replaced by Sonnet 3.7 and later.',
    displayName: 'Claude 3.5 Sonnet',
    family: 'claude-sonnet',
    generation: 'claude-3.5',
    id: 'anthropic/claude-3.5-sonnet',
    knowledgeCutoff: '2024-04',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Claude 3.7 Sonnet is an upgraded Sonnet model with stronger reasoning and coding, suitable for enterprise-grade complex tasks.',
    displayName: 'Claude 3.7 Sonnet',
    family: 'claude-sonnet',
    generation: 'claude-3.7',
    id: 'anthropic/claude-3.7-sonnet',
    knowledgeCutoff: '2024-10',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3.1 is DeepSeek’s long-context hybrid reasoning model, supporting mixed thinking/non-thinking modes and tool integration.',
    displayName: 'DeepSeek V3.1',
    family: 'deepseek',
    generation: 'deepseek-v3.1',
    id: 'deepseek/deepseek-chat-v3.1',
    maxOutput: 65_540,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.11, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.0 Flash is Google’s high-performance reasoning model for extended multimodal tasks.',
    displayName: 'Gemini 2.0 Flash',
    family: 'gemini',
    generation: 'gemini-2.0',
    id: 'google/gemini-2.0-flash',
    knowledgeCutoff: '2024-08',
    maxOutput: 8192,
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.0 Flash Lite is a lightweight Gemini variant with thinking disabled by default to improve latency and cost, but it can be enabled via parameters.',
    displayName: 'Gemini 2.0 Flash Lite',
    family: 'gemini',
    generation: 'gemini-2.0',
    id: 'google/gemini-2.0-flash-lite-001',
    knowledgeCutoff: '2024-08',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.5 Flash Lite is the lightweight Gemini 2.5 variant optimized for latency and cost, suitable for high-throughput scenarios.',
    displayName: 'Gemini 2.5 Flash Lite',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'google/gemini-2.5-flash-lite',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2 0905 is an update that expands context and reasoning performance with coding optimizations.',
    displayName: 'Kimi K2 0905',
    family: 'kimi',
    generation: 'kimi-k2',
    id: 'moonshotai/kimi-k2-0905',
    maxOutput: 262_144,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Qwen3-235B-A22B-Instruct-2507 is the Instruct variant in the Qwen3 series, balancing multilingual instruction use with long-context scenarios.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-235b-a22b-2507',
    maxOutput: 262_100,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.11, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Qwen3-235B-A22B-Thinking-2507 is the Thinking variant of Qwen3, strengthened for complex math and reasoning tasks.',
    displayName: 'Qwen3 235B A22B Thinking 2507',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-235b-a22b-thinking-2507',
    maxOutput: 262_100,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.78, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: { reasoning: true },
    contextWindowTokens: 128_000,
    description:
      'GLM 4.5 is Z.AI’s flagship model with hybrid reasoning optimized for engineering and long-context tasks.',
    displayName: 'GLM 4.5',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'z-ai/glm-4.5',
    maxOutput: 96_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.54, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];
