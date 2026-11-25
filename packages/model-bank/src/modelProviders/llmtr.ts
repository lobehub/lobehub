import type { ModelProviderCard } from '../types';

const Llmtr: ModelProviderCard = {
  apiKeyUrl: 'https://llmtr.com',
  chatModels: [],
  description:
    'LLMTR is an OpenAI-compatible gateway that routes chat models from many upstream providers through a single API and prepaid credit.',
  id: 'llmtr',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://llmtr.com/v1/models',
  name: 'LLMTR',
  settings: {
    proxyUrl: {
      placeholder: 'https://llmtr.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://llmtr.com',
};

export default Llmtr;
