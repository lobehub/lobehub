import type { AIChatModelCard } from '../types/aiModel';

// AvalAI is an OpenAI-compatible gateway that proxies frontier models from
// OpenAI, Anthropic, Google, Meta, Mistral, Qwen, DeepSeek and more.
// The full, up-to-date model list can be fetched from https://api.avalai.ir/v1/models
// ref: https://docs.avalai.ir
const avalaiChatModels: AIChatModelCard[] = [
  // OpenAI GPT series
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 delivers stronger reasoning and generation with a one-million-token context window.',
    displayName: 'GPT-4.1',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 mini balances intelligence, speed, and cost, making it attractive for many use cases.',
    displayName: 'GPT-4.1 mini',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-mini',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o is a flexible multimodal flagship model excelling at chat, vision, and tool use.',
    displayName: 'GPT-4o',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini is a fast and highly cost-effective small model for everyday tasks.',
    displayName: 'GPT-4o mini',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_384,
    type: 'chat',
  },

  // Anthropic Claude series
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description:
      'Claude Sonnet 4 offers a strong balance of intelligence, speed, and cost for coding and agent tasks.',
    displayName: 'Claude Sonnet 4',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-4',
    id: 'claude-sonnet-4-20250514',
    knowledgeCutoff: '2025-01',
    maxOutput: 64_000,
    releasedAt: '2025-05-23',
    type: 'chat',
  },

  // Google Gemini series
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Flash is a fast, cost-efficient multimodal model with a one-million-token context window.',
    displayName: 'Gemini 2.5 Flash',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'gemini-2.5-flash',
    maxOutput: 65_536,
    type: 'chat',
  },

  // DeepSeek series
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 128_000,
    description:
      'A DeepSeek reasoning model that thinks before answering, excelling at math, coding, and complex reasoning.',
    displayName: 'DeepSeek Reasoner',
    enabled: true,
    family: 'deepseek',
    id: 'deepseek-reasoner',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 64_000,
    description: 'A DeepSeek chat model that performs strongly in coding and reasoning.',
    displayName: 'DeepSeek Chat',
    enabled: true,
    family: 'deepseek',
    id: 'deepseek-chat',
    maxOutput: 64_000,
    type: 'chat',
  },
];

export const allModels = [...avalaiChatModels];

export default allModels;
