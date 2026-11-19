import type { AIChatModelCard } from '../../types/aiModel';

export const openaiGpt62ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-6.2 Astra is built for demanding projects in software development, computer use, and professional documents.',
    displayName: 'GPT-6.2 Astra',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6.2',
    id: 'gpt-6.2-astra',
    isOfficial: true,
    knowledgeCutoff: '2026-05',
    maxOutput: 128_000,
    /** @see https://developers.openai.com/api/docs/models/gpt-6.2-astra */
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 8, upTo: 272_000 },
            { rate: 16, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.4, upTo: 272_000 },
            { rate: 0.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 272_000 },
            { rate: 20, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 40, upTo: 272_000 },
            { rate: 60, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-11-17',
    settings: {
      extendParams: ['gpt6ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-6.2 Sol is an efficient model for everyday work, from coding to running agent workflows at scale.',
    displayName: 'GPT-6.2 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6.2',
    id: 'gpt-6.2-sol',
    isOfficial: true,
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    /** @see https://developers.openai.com/api/docs/models/gpt-6.2-sol */
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 272_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.1, upTo: 272_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 2.5, upTo: 272_000 },
            { rate: 5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 272_000 },
            { rate: 15, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-11-17',
    settings: {
      extendParams: ['gpt6ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
