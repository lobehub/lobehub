import type { AIChatModelCard } from '../../types/aiModel';

export const openaiGpt6ChatModels: AIChatModelCard[] = [
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
      'GPT-6.1 Terra is the mid-tier model in the GPT-6.1 series, priced below GPT-6.1 Sol, for everyday agentic, coding and writing work.',
    displayName: 'GPT-6.1 Terra',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6.1',
    id: 'openai/gpt-6.1-terra',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1, upTo: 272_000 },
            { rate: 2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.05, upTo: 272_000 },
            { rate: 0.1, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 1.25, upTo: 272_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 5, upTo: 272_000 },
            { rate: 7.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-10-26',
    settings: { extendParams: ['gpt5_6ReasoningEffort', 'textVerbosity'], searchImpl: 'params' },
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
    description: 'GPT-6 Sol is built for complex coding and agentic workflows.',
    displayName: 'GPT-6 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'openai/gpt-6-sol',
    knowledgeCutoff: '2026-04',
    maxOutput: 128_000,
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
            { rate: 0.2, upTo: 272_000 },
            { rate: 0.4, upTo: 'infinity' },
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
    releasedAt: '2026-09-22',
    settings: { extendParams: ['gpt5_6ReasoningEffort', 'textVerbosity'], searchImpl: 'params' },
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
    description: 'GPT-6 Luna is OpenAI’s most efficient model for focused, high-volume tasks.',
    displayName: 'GPT-6 Luna',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'openai/gpt-6-luna',
    knowledgeCutoff: '2026-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.1, upTo: 272_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.01, upTo: 272_000 },
            { rate: 0.02, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 0.125, upTo: 272_000 },
            { rate: 0.25, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.5, upTo: 272_000 },
            { rate: 0.75, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-22',
    settings: { extendParams: ['gpt5_6ReasoningEffort', 'textVerbosity'], searchImpl: 'params' },
    type: 'chat',
  },
];
