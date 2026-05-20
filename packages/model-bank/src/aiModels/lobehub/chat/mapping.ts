import type { AIChatModelCard } from '../../../types/aiModel';

export const mappingChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    enabled: true,
    id: 'lobehub-onboarding-v1',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
    visible: false,
  },
];
