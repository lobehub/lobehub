import type { AIChatModelCard } from '../types/aiModel';

const jalapenocloudChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Pro is the flagship of the V4 family, built for high-intensity reasoning and agentic workflows with a 1M context window.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'DeepSeek-V4-Pro',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export const allModels = [...jalapenocloudChatModels];

export default allModels;
