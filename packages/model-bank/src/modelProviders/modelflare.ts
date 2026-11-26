import type { ModelProviderCard } from '../types';

// ref: https://docs.modelflare.dev
const Modelflare: ModelProviderCard = {
  apiKeyUrl:
    'https://modelflare.dev/sign-up?utm_source=lobehub&utm_medium=provider-pr&utm_campaign=integrations',
  chatModels: [],
  checkModel: 'gpt-5.4',
  description:
    'Modelflare is an OpenAI-compatible AI API gateway: one Smart API Key calls every model available to your account, including GPT, Claude, Gemini, and more.',
  id: 'modelflare',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://modelflare.dev/pricing',
  name: 'Modelflare',
  settings: {
    proxyUrl: {
      placeholder: 'https://modelflare.dev/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://modelflare.dev',
};

export default Modelflare;
