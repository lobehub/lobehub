import type { ModelProviderCard } from '../types';

// ref: https://teapotrouter.com/api/pricing
const TeapotRouter: ModelProviderCard = {
  apiKeyUrl: 'https://teapotrouter.com/dashboard/keys',
  chatModels: [],
  checkModel: 'claude-sonnet-5',
  description:
    'Teapot Router is an OpenAI- and Anthropic-compatible API gateway for coding agents — Claude, GPT and Codex models on one key, pay-as-you-go from $1.',
  enabled: true,
  id: 'teapot-router',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://teapotrouter.com/pricing',
  name: 'Teapot Router',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.teapotrouter.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://teapotrouter.com',
};

export default TeapotRouter;
