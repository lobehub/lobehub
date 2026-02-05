import type { AIChatModelCard } from '../types/aiModel';

const v0ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 512_000,
    description: 'v0-1.5-lg is suited for advanced thinking or reasoning tasks.',
    displayName: 'v0-1.5-lg',
    enabled: true,
    id: 'v0-1.5-lg',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'v0-1.5-md is suited for everyday tasks and UI generation.',
    displayName: 'v0-1.5-md',
    enabled: true,
    id: 'v0-1.5-md',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'v0-1.0-md is a legacy model served via the v0 API.',
    displayName: 'v0-1.0-md',
    id: 'v0-1.0-md',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...v0ChatModels];

export default allModels;
