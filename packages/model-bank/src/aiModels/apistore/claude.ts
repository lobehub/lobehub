import type { AIChatModelCard } from '../../types/aiModel';

export const apistoreClaudeModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "Claude Fable 5 is Anthropic's strongest model — a new tier above Opus for the most demanding reasoning, agentic work, and coding, at a premium price.",
    displayName: 'Claude Fable 5',
    enabled: false,
    family: 'claude-mythos',
    generation: 'mythos-5',
    id: 'claude-fable-5',
    knowledgeCutoff: '2026-01',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 8.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-09',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Fable 5.1 is Anthropic's most capable generally available model. It outperforms Fable 5 on long-running coding and research at the same base price, with cache reads at a quarter of the cost.",
    displayName: 'Claude Fable 5.1',
    enabled: false,
    family: 'claude-mythos',
    generation: 'mythos-5.1',
    id: 'claude-fable-5-1',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 8.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-01',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Fable 5.2 is Anthropic's latest model for demanding reasoning and long-horizon agentic work, priced below Fable 5.1.",
    displayName: 'Claude Fable 5.2',
    enabled: true,
    family: 'claude-mythos',
    generation: 'mythos-5.2',
    id: 'claude-fable-5-2',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-11-09',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 200_000,
    description:
      'Claude Haiku 4.5 by Anthropic — next-gen Haiku with enhanced reasoning and vision.',
    displayName: 'Claude Haiku 4.5',
    enabled: false,
    family: 'claude-haiku',
    generation: 'claude-4.5',
    id: 'claude-haiku-4-5',
    knowledgeCutoff: '2025-02',
    maxOutput: 64_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.875, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Haiku 5.5 is Anthropic's fastest and most cost-efficient model, built for high-volume, latency-sensitive work such as classification, extraction, routing, and subagent tasks, with adaptive thinking and adjustable effort.",
    displayName: 'Claude Haiku 5.5',
    enabled: true,
    family: 'claude-haiku',
    generation: 'claude-5.5',
    id: 'claude-haiku-5-5',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.007, upTo: 100_000 },
            { rate: 0.035, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.07, upTo: 100_000 },
            { rate: 0.35, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.35, upTo: 100_000 },
            { rate: 1.75, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 0.0875, upTo: 100_000 },
            { rate: 0.4375, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-10-07',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4.5 by Anthropic — flagship model with top-tier reasoning and coding.',
    displayName: 'Claude Opus 4.5',
    enabled: false,
    family: 'claude-opus',
    generation: 'claude-4.5',
    id: 'claude-opus-4-5',
    knowledgeCutoff: '2025-05',
    maxOutput: 64_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 17.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 4.375, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-24',
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
    contextWindowTokens: 1_000_000,
    description:
      'Claude Opus 4.6 is Anthropic’s most intelligent model for building agents and coding.',
    displayName: 'Claude Opus 4.6',
    enabled: false,
    family: 'claude-opus',
    generation: 'claude-4.6',
    id: 'claude-opus-4-6',
    knowledgeCutoff: '2025-05',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 17.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 4.375, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-05',
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Opus 4.7 is Anthropic's most capable generally available model for complex reasoning and agentic coding.",
    displayName: 'Claude Opus 4.7',
    enabled: false,
    family: 'claude-opus',
    generation: 'claude-4.7',
    id: 'claude-opus-4-7',
    knowledgeCutoff: '2026-01',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 17.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 4.375, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-16',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Opus 4.8 is Anthropic's flagship Opus model, building on Opus 4.7 with improvements across reasoning, agentic coding, and tool use.",
    displayName: 'Claude Opus 4.8',
    enabled: false,
    family: 'claude-opus',
    generation: 'claude-4.8',
    id: 'claude-opus-4-8',
    knowledgeCutoff: '2026-01',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 17.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 4.375, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-28',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Opus 5 is Anthropic's strongest Opus model, built for deep reasoning, agentic coding, and long-horizon professional work.",
    displayName: 'Claude Opus 5',
    enabled: false,
    family: 'claude-opus',
    generation: 'claude-5',
    id: 'claude-opus-5',
    knowledgeCutoff: '2026-05',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 17.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 4.375, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-24',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 1_000_000,
    description:
      'Claude Opus 5.5 is built for long-running agentic coding and knowledge work, outperforming Claude Fable 5.1 on Terminal-Bench 4.0 at a lower price than Claude Opus 5.',
    displayName: 'Claude Opus 5.5',
    enabled: true,
    family: 'claude-opus',
    generation: 'claude-5.5',
    id: 'claude-opus-5-5',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 1_000_000,
    description: 'Claude Sonnet 4.6 is Anthropic’s best combination of speed and intelligence.',
    displayName: 'Claude Sonnet 4.6',
    enabled: false,
    family: 'claude-sonnet',
    generation: 'claude-4.6',
    id: 'claude-sonnet-4-6',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-17',
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Sonnet 5 is Anthropic's most agentic Sonnet model, built for sustained coding, tool use, and long-context workflows with Sonnet-tier speed and efficiency.",
    displayName: 'Claude Sonnet 5',
    enabled: false,
    family: 'claude-sonnet',
    generation: 'claude-5',
    id: 'claude-sonnet-5',
    knowledgeCutoff: '2026-01',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-30',
    settings: {
      disabledParams: ['temperature', 'top_p'],
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
    contextWindowTokens: 1_000_000,
    description:
      'Claude Sonnet 5.5 is a smarter, more efficient Sonnet that improves on Sonnet 5 in coding and knowledge work at the same base price, with cache reads at half the cost.',
    displayName: 'Claude Sonnet 5.5',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-5.5',
    id: 'claude-sonnet-5-5',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-28',
    settings: {
      disabledParams: ['temperature', 'top_p'],
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];
