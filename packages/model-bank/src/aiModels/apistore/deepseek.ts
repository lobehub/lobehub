import type { AIChatModelCard } from '../../types/aiModel';

// Peak-hour rates (weekdays 09:00-12:00 and 14:00-18:00 UTC+8). Off-peak requests cost about
// half as much; see https://apistore.cloud/pricing.
export const apistoreDeepSeekModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4.1 Flash is the latest fast, cost-efficient member of the V4 family, with a 1M context window and hybrid thinking.',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-1-flash',
    maxOutput: 393_216,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0042, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.84, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-10',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description: 'DeepSeek V4.1 Flash served on a lower-priced economy tier.',
    displayName: 'DeepSeek V4.1 Flash Economy',
    enabled: false,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-1-flash-economy',
    maxOutput: 393_216,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0035, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.168, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.672, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-10',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];
