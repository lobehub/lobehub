import type { AIChatModelCard } from '../../types/aiModel';

export const minimaxM3ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'MiniMax-M3 is the multimodal MiniMax foundation model for long-horizon agent work and coding, with tool calling and a 1M-token context.',
    displayName: 'MiniMax-M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax/minimax-m3',
    maxOutput: 512_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-31',
    settings: { extendParams: ['enableReasoning'] },
    type: 'chat',
  },
];
