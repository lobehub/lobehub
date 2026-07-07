import { type AIChatModelCard } from '../types/aiModel';

// ref: https://platform.moonshot.ai/docs
// Kimi Code API model: https://www.kimi.com/code/docs/third-party-tools/other-coding-agents.html

const kimiCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.6 is Kimi's latest and most capable coding model, delivering strong long-horizon coding, instruction following, and self-correction.",
    displayName: 'Kimi K2.6',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 32_768,
    organization: 'Moonshot',
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
    family: 'kimi',
    generation: 'kimi-k2',
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
