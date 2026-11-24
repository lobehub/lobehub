import type { ModelProviderCard } from '../types';

// ref: https://apistore.cloud/docs
// Model catalog: https://apistore.cloud/api/public/models
const APIStore: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-haiku-4-5',
  description:
    'API Store serves Claude, GPT, Gemini, and DeepSeek models through one OpenAI-compatible API and a single API key, billed per token.',
  id: 'apistore',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://apistore.cloud/pricing',
  name: 'API Store',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://api.apistore.cloud/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://apistore.cloud',
};

export default APIStore;
