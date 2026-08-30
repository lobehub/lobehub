import type { ModelProviderCard } from '../types';

const Modelsell: ModelProviderCard = {
  apiKeyUrl: 'https://modelsell.com/console/token',
  chatModels: [],
  description:
    'Modelsell provides unified access to multiple AI models through an OpenAI-compatible API.',
  enabled: true,
  id: 'modelsell',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://modelsell.com/v1/models',
  name: 'Modelsell',
  settings: {
    proxyUrl: {
      placeholder: 'https://modelsell.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://modelsell.com',
};

export default Modelsell;
