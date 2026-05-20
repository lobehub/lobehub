import { type AIChatModelCard } from '../types/aiModel';

// ref: https://platform.moonshot.ai/docs

const kimiCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'k2p5',
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.5 is Kimi's most versatile model to date, featuring a native multimodal architecture that supports both vision and text inputs, 'thinking' and 'non-thinking' modes, and both conversational and agent tasks.",
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-01-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2 Thinking: Thinking model with general Agentic capabilities and reasoning abilities.',
    displayName: 'Kimi K2 Thinking',
    id: 'kimi-k2-thinking',
    maxOutput: 65_536,
    organization: 'Moonshot',
    releasedAt: '2025-11-06',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
];

export default kimiCodingPlanChatModels;
