import type { AIChatModelCard } from '../types/aiModel';

// The Grid addresses capability tiers rather than a specific lab's model name; a tier
// routes to a current model for that tier. Lab-pinned instruments use the `*-latest` ids.
// Catalog: https://api.thegrid.ai/v1/models
// Specs:   https://thegrid.ai/docs/instrument-specifications/current-instruments
//
// No `pricing` block: The Grid is market-priced and the catalog currently publishes no
// per-token rate, so any static figure here would be wrong. The model fetcher is enabled
// on the provider so the live catalog stays authoritative.

const thegridChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 128_000,
    description:
      'Price-optimized, high-throughput text for high-volume, low-stakes work. An instrument where any qualifying model can fill orders, so you contract for the specification, not a model name.',
    displayName: 'Text Standard',
    enabled: true,
    id: 'text-standard',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 196_608,
    description:
      'The production default for everyday text generation. Strong reasoning at a fraction of frontier cost, suited to RAG, content drafting, summarization, and customer-facing generation.',
    displayName: 'Text Prime',
    id: 'text-prime',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Frontier-tier text for high-stakes, long-context work. The 1M-token context window handles synthesis across many documents.',
    displayName: 'Text Max',
    id: 'text-max',
    maxOutput: 128_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 128_000,
    description:
      'Price-optimized, high-throughput code for autocomplete, linting, and batch edits where latency and throughput dominate over reasoning depth.',
    displayName: 'Code Standard',
    id: 'code-standard',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 196_608,
    description:
      'The production default for daily coding work. Fast enough for interactive use and capable on non-trivial tasks.',
    displayName: 'Code Prime',
    enabled: true,
    id: 'code-prime',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Frontier-tier code for changes that span a whole codebase. The 1M-token context window handles full-repo analysis and large multi-file refactors.',
    displayName: 'Code Max',
    id: 'code-max',
    maxOutput: 128_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 128_000,
    description:
      'Price-optimized, high-throughput agents for orchestration glue, routing, tool selection, and high-volume single-purpose agents.',
    displayName: 'Agent Standard',
    id: 'agent-standard',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 196_608,
    description:
      'The production default for daily agent work, production agent loops, multi-step tool chains, and planning.',
    displayName: 'Agent Prime',
    id: 'agent-prime',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Frontier-tier agents for autonomous work, deep tool chains, long-horizon research, and high-stakes automation.',
    displayName: 'Agent Max',
    enabled: true,
    id: 'agent-max',
    maxOutput: 128_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Lab latest market for Claude Opus frontier supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'Claude Opus Latest',
    id: 'claude-opus-latest',
    maxOutput: 128_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Lab latest market for GPT frontier supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'GPT Sol Latest',
    id: 'gpt-sol-latest',
    maxOutput: 128_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Lab latest market for Gemini Pro frontier supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'Gemini Pro Latest',
    id: 'gemini-pro-latest',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    description:
      'Lab latest market for DeepSeek Pro supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'DeepSeek Pro Latest',
    id: 'deepseek-pro-latest',
    maxOutput: 384_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    description:
      'Lab latest market for GLM supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'GLM Latest',
    id: 'glm-latest',
    maxOutput: 128_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'Lab latest market for Kimi supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'Kimi Latest',
    id: 'kimi-latest',
    // maxOutput omitted: the catalog reports max_completion_tokens equal to the
    // full context window (1_048_576), which cannot be an output ceiling.
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    description:
      'Lab latest market for MiniMax supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'MiniMax Latest',
    id: 'minimax-latest',
    maxOutput: 512_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 262_144,
    description:
      'Lab latest market for ByteDance Pro supply. You contract for the latest qualifying route, not a specific model.',
    displayName: 'ByteDance Pro Latest',
    id: 'bytedance-pro-latest',
    maxOutput: 131_072,
    type: 'chat',
  },
];

export default thegridChatModels;
