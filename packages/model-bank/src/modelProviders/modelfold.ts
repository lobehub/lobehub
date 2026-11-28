import type { ModelProviderCard } from '../types';

const ModelFold: ModelProviderCard = {
  apiKeyUrl: 'https://modelfold.ai/docs/guide/authentication',
  chatModels: [],
  checkModel: 'deepseek-v4-flash',
  description: 'ModelFold provides access to chat models through an OpenAI-compatible API.',
  id: 'modelfold',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://modelfold.ai/v1/models',
  name: 'ModelFold',
  settings: {
    proxyUrl: { placeholder: 'https://modelfold.ai/v1' },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://modelfold.ai',
};

export default ModelFold;
