import type { AIChatModelCard } from '../../types/aiModel';

export const zaiGlm5ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.3 is the Z.ai reasoning model for software engineering and long-horizon agent work, with tool calling and a 1M-token context at a low price.',
    displayName: 'GLM-5.3',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'z-ai/glm-5.3',
    maxOutput: 943_718,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.0689, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.0699, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-18',
    type: 'chat',
  },
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
      'GLM-5.3 Flash is the low-cost multimodal Z.ai model for coding and agent tasks, with tool calling, optional reasoning and a 1M-token context.',
    displayName: 'GLM-5.3 Flash',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'z-ai/glm-5.3-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.0163, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.0163, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1479, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-26',
    type: 'chat',
  },
];
