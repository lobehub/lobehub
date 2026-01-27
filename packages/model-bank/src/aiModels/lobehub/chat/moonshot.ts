import { AIChatModelCard } from '../../../types/aiModel';

export const moonshotChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "kimi-k2.5 is Kimi's most versatile model to date, featuring a native multimodal architecture that supports both visual and text input, thinking and non-thinking modes, and dialogue and agent tasks. Supports long thinking and deep reasoning.",
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'kimi-k2.5',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
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
