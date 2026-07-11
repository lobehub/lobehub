import type { AIChatModelCard } from '../types/aiModel';

// Grok models available through the SuperGrok / X Premium subscription.
// Same model ids as the `xai` provider, but without pricing: usage is
// covered by the flat-rate subscription, so per-token cost would mislead.
// Only the latest generation is listed by default — older models can still
// be pulled in via the remote model list.
// ref: https://docs.x.ai/docs/models
const superGrokChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 500_000,
    description:
      "SpaceXAI's flagship model for coding, agentic tasks, and knowledge work — configurable reasoning (low/medium/high, always on).",
    displayName: 'Grok 4.5',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.5',
    id: 'grok-4.5',
    releasedAt: '2026-07-08',
    settings: {
      extendParams: ['grok4_5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export default superGrokChatModels;
