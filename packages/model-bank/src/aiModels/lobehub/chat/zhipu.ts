import type { AIChatModelCard } from '../../../types/aiModel';

export const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Zai's new-generation flagship foundation model, designed for Agentic Engineering, capable of providing reliable productivity in complex system engineering and long-range Agent tasks.",
    displayName: 'GLM-5',
    enabled: true,
    id: 'glm-5',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
