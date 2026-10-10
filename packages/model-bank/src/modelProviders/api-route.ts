import type { ModelProviderCard } from '../types';

const ApiRoute: ModelProviderCard = {
  apiKeyUrl: 'https://www.api-route.com',
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description: 'API Route provides access to multiple AI models through an OpenAI-compatible API.',
  enabled: true,
  id: 'api-route',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://global.api-route.com/v1/models',
  name: 'API Route',
  settings: {
    proxyUrl: { placeholder: 'https://global.api-route.com/v1' },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.api-route.com',
};

export default ApiRoute;
