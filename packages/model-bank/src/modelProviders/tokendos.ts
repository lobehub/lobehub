import type { ModelProviderCard } from '../types';

const TokenDos: ModelProviderCard = {
  apiKeyUrl: 'https://www.tokendos.com/token',
  chatModels: [],
  checkModel: 'claude-3-7-sonnet-20250219',
  description:
    'TokenDos provides high-performance, low-latency AI model routing with native Anthropic Claude and OpenAI compatibility, real-time availability and 1:1 billing.',
  id: 'tokendos',
  modelsUrl: 'https://www.tokendos.com/tokendos-models',
  name: 'TokenDos',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.tokendos.com',
    },
    sdkType: 'router',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://www.tokendos.com?utm_source=lobehub',
};

export default TokenDos;
