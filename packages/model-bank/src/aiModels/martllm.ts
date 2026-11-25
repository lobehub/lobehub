import type { AIChatModelCard } from '../types/aiModel';

// A few models MartLLM lists, with the ids and limits its GET /v1/models
// returns (read 2026-11-25). The full list is fetched from the API. Prices are
// left out on purpose: each request costs what the provider that served it
// charged, so a fixed rate here would be wrong.
const martllmChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 128_000,
    displayName: 'GPT-4o Mini',
    enabled: true,
    id: 'openai/gpt-4o-mini',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    id: 'anthropic/claude-haiku-4.5',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 1_048_576,
    displayName: 'Gemini 2.5 Flash',
    enabled: true,
    id: 'google/gemini-2.5-flash',
    maxOutput: 65_535,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    displayName: 'Gemini 2.5 Pro',
    id: 'google/gemini-2.5-pro',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 160_000,
    displayName: 'DeepSeek V3.2',
    enabled: true,
    id: 'deepseek/deepseek-v3.2',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 198_000,
    displayName: 'GLM-4.6',
    id: 'z-ai/glm-4.6',
    maxOutput: 16_384,
    type: 'chat',
  },
];

export const allModels = [...martllmChatModels];

export default allModels;
