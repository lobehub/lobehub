import type { ModelProviderCard } from '../types';

// ref: https://freeaiapikey.com/docs
const FreeAIapikey: ModelProviderCard = {
  chatModels: [],
  checkModel: 'openai/gpt-5.5',
  description:
    'FreeAIapikey is an OpenAI-compatible API gateway offering one-key access to frontier models — GPT-5.5, GPT-5.6 Sol, GPT-6 Sol, GPT-6 Astra, Claude Opus 4.7/4.8/5/5.5 and Claude Sonnet 5 — at a fraction of official pricing.',
  disableBrowserRequest: true,
  id: 'freeaiapikey',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://freeaiapikey.com/models',
  name: 'FreeAIapikey',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.freeaiapikey.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://freeaiapikey.com',
};

export default FreeAIapikey;
