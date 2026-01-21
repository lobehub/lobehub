import { AIChatModelCard } from '../../../types/aiModel';

export const moonshotChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'kimi-k2 is an MoE foundation model with strong coding and agent capabilities (1T total params, 32B active), outperforming other mainstream open models across reasoning, programming, math, and agent benchmarks.',
    displayName: 'Kimi K2',
    enabled: true,
    id: 'kimi-k2-0711-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-11',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
