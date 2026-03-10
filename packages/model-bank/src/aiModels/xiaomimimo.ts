import type { AIChatModelCard } from '../types/aiModel';

const xiaomimimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description: 'MiMo-V2-Flash: An efficient model for reasoning, coding, and agent foundations.',
    displayName: 'MiMo-V2 Flash',
    enabled: true,
    id: 'mimo-v2-flash',
    maxOutput: 131_072,
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export const allModels = [...xiaomimimoChatModels];

export default allModels;
