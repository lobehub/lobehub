import { type AIChatModelCard } from '../types/aiModel';

// ref: https://platform.minimax.io/docs/coding-plan/intro

const minimaxCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax M2.7: Beginning the journey of recursive self-improvement, top real-world engineering capabilities.',
    displayName: 'MiniMax M2.7',
    enabled: true,
    id: 'MiniMax-M2.7',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-03-18',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax M2.7 Highspeed: Same performance as M2.7 with significantly faster inference.',
    displayName: 'MiniMax M2.7 Highspeed',
    id: 'MiniMax-M2.7-highspeed',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-03-18',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax M2.5: Flagship open-source large model focusing on solving complex real-world tasks.',
    displayName: 'MiniMax M2.5',
    enabled: true,
    id: 'MiniMax-M2.5',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-02-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 204_800,
    description: 'MiniMax M2.5 Highspeed: Same performance as M2.5 with faster inference.',
    displayName: 'MiniMax M2.5 Highspeed',
    id: 'MiniMax-M2.5-highspeed',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-02-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 204_800,
    description: 'MiniMax M2.1: 230B total parameters with 10B activated per inference.',
    displayName: 'MiniMax M2.1',
    id: 'MiniMax-M2.1',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2025-12-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 204_800,
    description: 'MiniMax M2: Previous generation model.',
    displayName: 'MiniMax M2',
    id: 'MiniMax-M2',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2025-12-23',
    type: 'chat',
  },
];

export default minimaxCodingPlanChatModels;
