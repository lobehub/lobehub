import type { AIDecisionModelCard } from '../types/aiModel';

export const typeSafeModels: AIDecisionModelCard[] = [
  {
    contextWindowTokens: 65_536,
    description:
      'TypeSafe Jev is a System One decision model that returns calibrated probabilities for typed questions instead of generated prose.',
    displayName: 'Jev 1.14',
    enabled: true,
    id: 'jev-1.14.0',
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.042, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-10-14',
    type: 'decision',
  },
];
