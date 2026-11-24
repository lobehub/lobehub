import type { AIChatModelCard } from '../../types/aiModel';

export const apistoreGptModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      "GPT-5.5 is OpenAI's previous-generation frontier model for complex professional work.",
    displayName: 'GPT-5.5',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.5',
    id: 'gpt-5.5',
    knowledgeCutoff: '2025-12',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.35, upTo: 272_000 },
            { rate: 0.7, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 3.5, upTo: 272_000 },
            { rate: 7, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 21, upTo: 272_000 },
            { rate: 31.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-23',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Luna is optimized for cost-sensitive, high-volume workloads with the lowest price in the GPT-5.6 family.',
    displayName: 'GPT-5.6 Luna',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-luna',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.014, upTo: 272_000 },
            { rate: 0.028, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.14, upTo: 272_000 },
            { rate: 0.28, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.84, upTo: 272_000 },
            { rate: 1.26, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      "GPT-5.6 Sol is OpenAI's latest flagship and most capable model, the top choice in the GPT family for coding and agentic work.",
    displayName: 'GPT-5.6 Sol',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-sol',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.28, upTo: 272_000 },
            { rate: 0.56, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2.8, upTo: 272_000 },
            { rate: 5.6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 14, upTo: 272_000 },
            { rate: 21, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Terra balances intelligence and cost for everyday professional work, competitive with GPT-5.5 at about half the price.',
    displayName: 'GPT-5.6 Terra',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-terra',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.14, upTo: 272_000 },
            { rate: 0.28, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.4, upTo: 272_000 },
            { rate: 2.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 8.4, upTo: 272_000 },
            { rate: 12.6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'OpenAI’s most capable model for complex reasoning, coding, computer use, research, and document creation.',
    displayName: 'GPT-6 Astra',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-astra',
    knowledgeCutoff: '2026-04',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.7, upTo: 272_000 },
            { rate: 1.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 7, upTo: 272_000 },
            { rate: 14, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 35, upTo: 272_000 },
            { rate: 52.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-03',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description: 'GPT-6 Luna is OpenAI’s most efficient model for focused, high-volume tasks.',
    displayName: 'GPT-6 Luna',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-luna',
    knowledgeCutoff: '2026-05',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.007, upTo: 272_000 },
            { rate: 0.014, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.07, upTo: 272_000 },
            { rate: 0.14, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.35, upTo: 272_000 },
            { rate: 0.525, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description: 'GPT-6 Sol is built for complex coding and agentic workflows.',
    displayName: 'GPT-6 Sol',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-sol',
    knowledgeCutoff: '2026-04',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.14, upTo: 272_000 },
            { rate: 0.28, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.4, upTo: 272_000 },
            { rate: 2.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 7, upTo: 272_000 },
            { rate: 10.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-6.1 Sol delivers near-Astra performance for complex coding, computer use, and professional work at a lower cost.',
    displayName: 'GPT-6.1 Sol',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-6.1',
    id: 'gpt-6.1-sol',
    knowledgeCutoff: '2026-04',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.07, upTo: 272_000 },
            { rate: 0.14, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.4, upTo: 272_000 },
            { rate: 2.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 7, upTo: 272_000 },
            { rate: 10.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-29',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-6.1 Terra is a fast, efficient model for visual reasoning, precise computer use, and clear, natural writing.',
    displayName: 'GPT-6.1 Terra',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6.1',
    id: 'gpt-6.1-terra',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.035, upTo: 272_000 },
            { rate: 0.07, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.7, upTo: 272_000 },
            { rate: 1.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 3.5, upTo: 272_000 },
            { rate: 5.25, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-10-26',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
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
    knowledgeCutoff: '2026-05',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.28, upTo: 272_000 },
            { rate: 0.56, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 5.6, upTo: 272_000 },
            { rate: 11.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 28, upTo: 272_000 },
            { rate: 42, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-11-17',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
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
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.07, upTo: 272_000 },
            { rate: 0.14, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.4, upTo: 272_000 },
            { rate: 2.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 7, upTo: 272_000 },
            { rate: 10.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-11-17',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];
