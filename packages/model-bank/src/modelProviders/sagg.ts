import type { ModelProviderCard } from '../types';

const SAGG: ModelProviderCard = {
  apiKeyUrl: 'https://api.privatedeskai.com/pricing',
  chatModels: [],
  checkModel: 'deepseek-ai/DeepSeek-V4-Flash-0731',
  description:
    'SAGG is a multi-provider failover gateway, OpenAI-compatible, sitting between your code and several independent LLM providers.',
  id: 'sagg',
  modelsUrl: 'https://api.privatedeskai.com/models',
  name: 'SAGG',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.privatedeskai.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://api.privatedeskai.com',
};

export default SAGG;
