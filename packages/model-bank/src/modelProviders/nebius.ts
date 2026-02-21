import type { ModelProviderCard } from '@/types/llm';

const Nebius: ModelProviderCard = {
  chatModels: [],
  checkModel: 'Qwen/Qwen2.5-Coder-7B',
  description:
    'Nebius provides high-performance infrastructure for global AI innovators via large-scale GPU clusters and a vertically integrated cloud platform.',
  id: 'nebius',
  modelsUrl: 'https://studio.nebius.com/',
  name: 'Nebius',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.studio.nebius.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://nebius.com/',
};

export default Nebius;
