import type { AIChatModelCard } from '../types/aiModel';

// Curated built-in gateway IDs, checked against the official catalog on 2026-11-15.
// No live catalog fetch, provider pinning, retired models, or inferred prices/limits.
// @see https://docs.livekit.io/agents/models/inference/
const chatModels: AIChatModelCard[] = [
  {
    displayName: 'Gemma 4 31B',
    enabled: true,
    family: 'gemma',
    generation: 'gemma-4',
    id: 'google/gemma-4-31b-it',
    type: 'chat',
  },
  {
    displayName: 'GPT OSS 120B',
    enabled: true,
    family: 'gpt-oss',
    id: 'openai/gpt-oss-120b',
    type: 'chat',
  },
  {
    displayName: 'GPT-5.4 mini',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'openai/gpt-5.4-mini',
    type: 'chat',
  },
];

export const allModels = chatModels;

export default allModels;
