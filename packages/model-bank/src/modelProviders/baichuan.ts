import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.baichuan-ai.com/price
const Baichuan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'Baichuan3-Turbo',
  description:
    'Baichuan AI focuses on foundation models with strong performance on Chinese knowledge, long-context processing, and creative generation. Its models (Baichuan 4, Baichuan 3 Turbo, Baichuan 3 Turbo 128k) are optimized for different scenarios and offer strong value.',
  id: 'baichuan',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.baichuan-ai.com/price',
  name: 'Baichuan',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.baichuan-ai.com/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://platform.baichuan-ai.com',
};

export default Baichuan;
