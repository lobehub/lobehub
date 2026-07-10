import type { AIChatModelCard } from '../types/aiModel';

// Grok models available through the SuperGrok / X Premium subscription.
// Same model ids as the `xai` provider, but without pricing: usage is
// covered by the flat-rate subscription, so per-token cost would mislead.
// ref: https://docs.x.ai/docs/models
const superGrokChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'The most truth-seeking large language model in the world',
    displayName: 'Grok 4.3',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.3',
    id: 'grok-4.3',
    knowledgeCutoff: '2025-12',
    releasedAt: '2026-05-01',
    settings: {
      extendParams: ['grok4_3ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'A non-reasoning variant for simple use cases',
    displayName: 'Grok 4.20 (Non-Reasoning)',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.20',
    id: 'grok-4.20-0309-non-reasoning',
    releasedAt: '2026-03-09',
    settings: {
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
    contextWindowTokens: 1_000_000,
    description: 'Intelligent, blazing-fast model that reasons before responding',
    displayName: 'Grok 4.20',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.20',
    id: 'grok-4.20-0309-reasoning',
    releasedAt: '2026-03-09',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export default superGrokChatModels;
