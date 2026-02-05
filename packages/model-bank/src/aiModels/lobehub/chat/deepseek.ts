import type { AIChatModelCard } from '../../../types/aiModel';

export const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek V3.2 balances reasoning and output length for daily QA and agent tasks. Public benchmarks reach GPT-5 levels, and it is the first to integrate thinking into tool use, leading open-source agent evaluations.',
    displayName: 'DeepSeek V3.2',
    enabled: true,
    id: 'deepseek-chat',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.68, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek V3.2 Thinking is a deep reasoning model that generates chain-of-thought before outputs for higher accuracy, with top competition results and reasoning comparable to Gemini-3.0-Pro.',
    displayName: 'DeepSeek V3.2 Thinking',
    enabled: true,
    id: 'deepseek-reasoner',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.19, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
];
