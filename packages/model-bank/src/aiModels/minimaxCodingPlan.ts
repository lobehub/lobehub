import { type AIChatModelCard } from '../types/aiModel';

// ref: https://platform.minimaxi.com/docs/token-plan/intro
// Models synced from https://models.dev/api.json → minimax-cn-coding-plan

const minimaxCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'MiniMax multimodal coding model for long-context reasoning and agent tasks',
    displayName: 'MiniMax-M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'MiniMax-M3',
    maxOutput: 128_000,
    organization: 'MiniMax',
    releasedAt: '2026-06-01',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax model for chat, coding, office work, and agentic tasks',
    displayName: 'MiniMax-M2.7',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'MiniMax-M2.7',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-03-18',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'High-speed MiniMax model for low-latency coding and agent workflows',
    displayName: 'MiniMax-M2.7-highspeed',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'MiniMax-M2.7-highspeed',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-03-18',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax model for chat, coding, office work, and agentic tasks',
    displayName: 'MiniMax-M2.5',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.5',
    id: 'MiniMax-M2.5',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-02-12',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'High-speed MiniMax model for low-latency coding and agent workflows',
    displayName: 'MiniMax-M2.5-highspeed',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.5',
    id: 'MiniMax-M2.5-highspeed',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-02-13',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax model for chat, coding, office work, and agentic tasks',
    displayName: 'MiniMax-M2.1',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.1',
    id: 'MiniMax-M2.1',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2025-12-23',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 196_608,
    description: 'MiniMax model for chat, coding, office work, and agentic tasks',
    displayName: 'MiniMax-M2',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2',
    id: 'MiniMax-M2',
    maxOutput: 128_000,
    organization: 'MiniMax',
    releasedAt: '2025-10-27',
    // reasoning_options: []
    type: 'chat',
  },
];

export default minimaxCodingPlanChatModels;
