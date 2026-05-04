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
    id: 'kimi-for-coding',
    maxOutput: 32_768,
    organization: 'Moonshot',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export default kimiCodingPlanChatModels;
