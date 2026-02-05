import type { AIChatModelCard } from '../../../types/aiModel';

export const minimaxChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'Powerful multilingual programming capabilities, comprehensively upgraded programming experience.',
    displayName: 'MiniMax M2.1',
    enabled: true,
    id: 'MiniMax-M2.1',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'Powerful multilingual programming capabilities with faster and more efficient inference.',
    displayName: 'MiniMax M2.1 Lightning',
    enabled: true,
    id: 'MiniMax-M2.1-Lightning',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-23',
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
    id: 'MiniMax-M2-Stable',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-27',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
