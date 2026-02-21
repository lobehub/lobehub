import type { AIChatModelCard } from '../types/aiModel';

const ai21ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description:
      'The most efficient model in its class, balancing speed and quality with a smaller footprint.',
    displayName: 'Jamba Mini',
    enabled: true,
    id: 'jamba-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Our most powerful, advanced model, designed for complex enterprise tasks with outstanding performance.',
    displayName: 'Jamba Large',
    enabled: true,
    id: 'jamba-large',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-06',
    type: 'chat',
  },
];

export const allModels = [...ai21ChatModels];

export default allModels;
