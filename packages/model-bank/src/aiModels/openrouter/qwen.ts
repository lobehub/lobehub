import type { AIChatModelCard } from '../../types/aiModel';

export const qwen38ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.8 Flash is the fast multimodal reasoning model from Alibaba for agent workflows, coding and document analysis, with tool calling and a 1M-token context.',
    displayName: 'Qwen3.8 Flash',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen/qwen3.8-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.016, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.47, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-26',
    settings: { extendParams: ['enableReasoning'] },
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
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.8 Max (0902) is the September snapshot of the largest Qwen3.8 model, a mixture-of-experts model with tool calling and a 1M-token context.',
    displayName: 'Qwen3.8 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen/qwen3.8-max-0902',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-03',
    type: 'chat',
  },
];
