import type { AIDecisionModelCard } from '../../types/aiModel';

// https://openrouter.ai/models?output_modalities=decisions
export const openrouterDecisionModels: AIDecisionModelCard[] = [
  {
    contextWindowTokens: 64_000,
    description:
      'TypeSafe Jev is a System One decision model: it answers yes/no, choice, and score questions with calibrated probabilities instead of generating text.',
    displayName: 'Jev 1.13',
    id: 'typesafe/jev-1.13',
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.042, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-09-17',
    type: 'decision',
  },
  {
    contextWindowTokens: 1_050_000,
    description:
      'GPT-6 Luna served through the Decisions API: returns typed answers with probabilities for caller-defined questions, billed on input tokens only.',
    displayName: 'GPT-6 Luna Decisions',
    id: 'openai/gpt-6-luna-decisions',
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-10-06',
    type: 'decision',
  },
];
