import type { AIChatModelCard } from '../types/aiModel';

// The exchange lists the models that providers quote now, so the list is fetched at run time.
const liquidInferenceChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    description:
      'Liquid Auto sends each request to the best eligible offer on the exchange and fixes a price cap before the first token.',
    displayName: 'Liquid Auto',
    enabled: true,
    id: 'liquid.auto',
    type: 'chat',
  },
];

export const allModels = [...liquidInferenceChatModels];

export default allModels;
