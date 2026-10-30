import type { ModelProviderCard } from '../types';

const JZSTOKEN: ModelProviderCard = {
  apiKeyUrl: 'https://jzstoken.com/dashboard/keys',
  chatModels: [],
  checkModel: 'gpt-5.6-terra',
  description:
    'JZSTOKEN provides OpenAI-compatible access to OpenAI, Anthropic, Google, Kimi, DeepSeek, and other model families through one API key.',
  id: 'jzstoken',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://jzstoken.com/model-pricing',
  name: 'JZSTOKEN',
  settings: {
    proxyUrl: {
      placeholder: 'https://jzstoken.com/api/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://jzstoken.com',
};

export default JZSTOKEN;
