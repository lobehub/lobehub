import type { AIChatModelCard } from '../../types/aiModel';

export const moonshotK3ChatModels: AIChatModelCard[] = [
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
      'Kimi K3 is the open-weight multimodal reasoning model from Moonshot AI for coding, knowledge work and long-horizon agent workflows, with a 1M-token context.',
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'moonshotai/kimi-k3',
    maxOutput: 943_718,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.182, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.192, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-16',
    settings: { extendParams: ['enableReasoning'] },
    type: 'chat',
  },
];
