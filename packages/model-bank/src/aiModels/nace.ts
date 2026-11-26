import type { AIDecisionModelCard } from '../types/aiModel';

// https://console.nace.ai/docs/drex/reference/models
export const naceModels: AIDecisionModelCard[] = [
  {
    contextWindowTokens: 262_144,
    description:
      'Drex Max is the most accurate Drex decision model from Nace: it answers typed yes/no, choice, and score questions with calibrated probabilities instead of generated text.',
    displayName: 'Drex Max',
    enabled: true,
    id: 'drex-max',
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-10-13',
    type: 'decision',
  },
  {
    contextWindowTokens: 262_144,
    description:
      'Drex 2.0 is the Drex decision model behind the drex-latest alias, a mixture of experts with 3B active parameters that answers typed yes/no, choice, and score questions with calibrated probabilities instead of generated text.',
    displayName: 'Drex 2.0',
    enabled: true,
    id: 'drex-v2.0',
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-10-06',
    type: 'decision',
  },
];
