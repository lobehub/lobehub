import type { ModelProviderCard } from '../types';

const GreenPT: ModelProviderCard = {
  apiKeyUrl: 'https://account.greenpt.ai/api/keys',
  chatModels: [],
  checkModel: 'glm-5.2',
  description:
    'GreenPT is a European AI provider with an OpenAI-compatible API, optimized infrastructure, and data centers powered by 100% renewable energy.',
  id: 'greenpt',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.greenpt.ai/model-cards',
  name: 'GreenPT',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.greenpt.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://greenpt.com/api',
};

export default GreenPT;
