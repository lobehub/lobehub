import type { AIChatModelCard } from '../../../types/aiModel';

export const minimaxChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 524_288,
    description:
      'Latest flagship model with 512K context, 128K max output, and image input support.',
    displayName: 'MiniMax M3',
    enabled: true,
    id: 'MiniMax-M3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'First self-evolving model with top-tier coding and agentic performance (~60 tps).',
    displayName: 'MiniMax M2.7',
    enabled: true,
    id: 'MiniMax-M2.7',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description: 'Same performance as M2.7 with significantly faster inference (~100 tps).',
    displayName: 'MiniMax M2.7 Highspeed',
    enabled: true,
    id: 'MiniMax-M2.7-highspeed',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    type: 'chat',
  },
];
