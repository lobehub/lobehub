import type { AIChatModelCard } from '../../../types/aiModel';

export const anthropicChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: "Claude Sonnet 4.5 is Anthropic's most intelligent model to date.",
    displayName: 'Claude Sonnet 4.5',
    enabled: true,
    id: 'claude-sonnet-4-5-20250929',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-30',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Sonnet 4 is Anthropic's most intelligent model to date, offering near-instant responses or extended step-by-step thinking with fine-grained control for API users.",
    displayName: 'Claude Sonnet 4',
    id: 'claude-sonnet-4-20250514',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 6, '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Sonnet 3.7 is Anthropic's most intelligent model and the first hybrid reasoning model on the market, supporting near-instant responses or extended thinking with fine-grained control.",
    displayName: 'Claude Sonnet 3.7',
    id: 'claude-3-7-sonnet-20250219',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 6, '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4.6 is Anthropic's most intelligent model for building agents and coding.",
    displayName: 'Claude Opus 4.6',
    enabled: true,
    id: 'claude-opus-4-6',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['disableContextCaching', 'enableAdaptiveThinking', 'effort'],
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
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4.5 is Anthropic's flagship model, combining excellent intelligence and scalable performance for the highest-quality reasoning tasks.",
    displayName: 'Claude Opus 4.5',
    enabled: true,
    id: 'claude-opus-4-5-20251101',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 10, '5m': 6.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-24',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4.1 is Anthropic's latest and most capable model for highly complex tasks, excelling in performance, intelligence, fluency, and understanding.",
    displayName: 'Claude Opus 4.1',
    id: 'claude-opus-4-1-20250805',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 30, '5m': 18.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-08-05',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4 is Anthropic's most powerful model for highly complex tasks, excelling in performance, intelligence, fluency, and understanding.",
    displayName: 'Claude Opus 4',
    id: 'claude-opus-4-20250514',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 30, '5m': 18.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
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
    contextWindowTokens: 200_000,
    description:
      "Claude Haiku 4.5 is Anthropic's fastest and most intelligent Haiku model, with lightning speed and extended thinking.",
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    id: 'claude-haiku-4-5-20251001',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 2, '5m': 1.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-10-16',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude 3.5 Haiku is Anthropic's fastest next-gen model, improving across skills and surpassing the previous flagship Claude 3 Opus on many benchmarks.",
    displayName: 'Claude 3.5 Haiku',
    id: 'claude-3-5-haiku-20241022',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 1.6, '5m': 1 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-11-05',
    settings: {
      extendParams: ['disableContextCaching'],
    },
    type: 'chat',
  },
];
