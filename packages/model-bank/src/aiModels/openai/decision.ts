import type { AIDecisionModelCard } from '../../types/aiModel';

// https://developers.openai.com/api/docs/guides/decisions
export const openaiDecisionModels: AIDecisionModelCard[] = [
  {
    contextWindowTokens: 1_050_000,
    description:
      'GPT-6 Luna served through the Decisions API: returns typed answers with probabilities for caller-defined questions, billed on input tokens only.',
    displayName: 'GPT-6 Luna Decisions',
    /** Sent upstream as `gpt-6-luna`; the suffix only keeps the id apart from the chat card. */
    id: 'gpt-6-luna:decision',
    /**
     * Input only: no output, cache-read or cache-write charges. The long-context multiplier
     * still applies, so the tiers mirror the chat card's input tiers.
     * @see https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability
     */
    pricing: {
      units: [
        {
          name: 'textInput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 0.1, upTo: 272_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
        },
      ],
    },
    releasedAt: '2026-10-06',
    type: 'decision',
  },
];
