import type { ModelProviderCard } from '@/types/llm';

const AkashChat: ModelProviderCard = {
  chatModels: [],
  checkModel: 'Meta-Llama-3-1-8B-Instruct-FP8',
  description:
    'Akash is a permissionless cloud resource marketplace with competitive pricing compared to traditional cloud providers.',
  id: 'akashchat',
  modelsUrl: 'https://chatapi.akash.network/documentation',
  name: 'AkashChat',
  settings: {
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://chatapi.akash.network/',
};

export default AkashChat;
