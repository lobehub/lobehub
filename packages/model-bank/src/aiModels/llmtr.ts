import type { AIChatModelCard } from '../types/aiModel';

// Snapshot of chat models listed for LLMTR on models.dev (25 November 2026).
// Context and output limits and abilities come from that catalog. Pricing is
// omitted so a stale rate is not shown in the UI. The settings page can also
// refresh the list from GET https://llmtr.com/v1/models.
const llmtrChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen Flash',
    enabled: true,
    id: 'qwen/qwen-flash',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen Plus',
    id: 'qwen/qwen-plus',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen3 Coder Flash',
    id: 'qwen/qwen3-coder-flash',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen3 Coder Plus',
    id: 'qwen/qwen3-coder-plus',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen3.6 Flash',
    id: 'qwen/qwen3.6-flash',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen3.6 Plus',
    id: 'qwen/qwen3.6-plus',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen3.7 Plus',
    id: 'qwen/qwen3.7-plus',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    displayName: 'Gemini 2.5 Flash-Lite',
    enabled: true,
    id: 'google/gemini-2.5-flash-lite',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 131_072,
    displayName: 'Gemma 4',
    id: 'gemma-4',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    displayName: 'MiMo-V2.5',
    id: 'mimo/mimo-v2.5',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    displayName: 'MiMo-V2.5-Pro',
    id: 'mimo/mimo-v2.5-pro',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    displayName: 'Inkling Small',
    id: 'thinkingmachines/inkling-small',
    maxOutput: 262_144,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    displayName: 'Inkling',
    id: 'thinkingmachines/inkling',
    maxOutput: 262_144,
    type: 'chat',
  },
];

export const allModels = [...llmtrChatModels];

export default allModels;
