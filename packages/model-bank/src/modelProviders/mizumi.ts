import type { ModelProviderCard } from '../types';

// ref: https://mizumi.co/docs
const Mizumi: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4.1-mini',
  description:
    'Mizumi is an OpenAI-compatible LLM API gateway offering frontier models at 15–28% below official list pricing with spend-based tiers, zero prompt retention, and a $2 free trial credit.',
  disableBrowserRequest: true,
  id: 'mizumi',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://mizumi.co/docs',
  name: 'Mizumi',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.mizumi.co/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://mizumi.co',
};

export default Mizumi;
