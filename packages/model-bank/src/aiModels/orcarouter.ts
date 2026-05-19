import type { AIChatModelCard } from '../types/aiModel';

// OrcaRouter ships an adaptive routing engine on top of 150+ upstream models.
// `orcarouter/auto` is the workspace-level virtual router; every other entry is a
// concrete upstream addressable by id. Full catalog: https://www.orcarouter.ai/models
const orcarouterChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 128_000,
    description:
      'OrcaRouter Auto — adaptive LinUCB router that picks the best upstream per request based on prompt features, cost, latency, and quality signals. Configure routing strategy (cheapest / balanced / quality / adaptive / gated_adaptive) in https://www.orcarouter.ai/console/routing.',
    displayName: 'OrcaRouter Auto',
    enabled: true,
    id: 'orcarouter/auto',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 400_000,
    description: 'OpenAI GPT-5 flagship via OrcaRouter.',
    displayName: 'GPT-5',
    enabled: true,
    id: 'openai/gpt-5',
    maxOutput: 128_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'Anthropic Claude Opus 4.7 flagship reasoning model via OrcaRouter.',
    displayName: 'Claude Opus 4.7',
    enabled: true,
    id: 'anthropic/claude-opus-4.7',
    maxOutput: 32_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Google Gemini 3 Flash Preview via OrcaRouter.',
    displayName: 'Gemini 3 Flash Preview',
    enabled: true,
    id: 'google/gemini-3-flash-preview',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 256_000,
    description: 'xAI Grok 4.3 flagship via OrcaRouter.',
    displayName: 'Grok 4.3',
    enabled: true,
    id: 'grok/grok-4.3',
    maxOutput: 32_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 128_000,
    description: 'DeepSeek V4 Pro flagship via OrcaRouter.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek/deepseek-v4-pro',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 256_000,
    description: 'MiniMax M2.7 flagship via OrcaRouter.',
    displayName: 'MiniMax M2.7',
    enabled: true,
    id: 'minimax/minimax-m2.7',
    maxOutput: 32_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 128_000,
    description: 'Alibaba Qwen 3.6 Flash via OrcaRouter.',
    displayName: 'Qwen 3.6 Flash',
    enabled: true,
    id: 'qwen/qwen3.6-flash',
    maxOutput: 16_384,
    type: 'chat',
  },
];

export const allModels = [...orcarouterChatModels];

export default allModels;
