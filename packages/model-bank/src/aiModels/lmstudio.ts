import type { AIChatModelCard } from '../types/aiModel';

const lmStudioChatModels: AIChatModelCard[] = [
  {
    abilities: {},
    contextWindowTokens: 128_000,
    description:
      'Llama 3.1 is Meta’s leading model family, scaling up to 405B parameters for complex dialogue, multilingual translation, and data analysis.',
    displayName: 'Llama 3.1 8B',
    enabled: true,
    id: 'llama3.1',
    type: 'chat',
  },
  {
    abilities: {},
    contextWindowTokens: 128_000,
    description:
      "Qwen2.5 is Alibaba's next-generation large language model, delivering strong performance across diverse use cases.",
    displayName: 'Qwen2.5 14B',
    enabled: true,
    id: 'qwen2.5-14b-instruct',
    type: 'chat',
  },
];

export const allModels = [...lmStudioChatModels];

export default allModels;
