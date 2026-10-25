import type { ModelProviderCard } from '../types';

// ref: https://docs.litellm.ai/docs/providers/litellm_proxy
const LiteLLM: ModelProviderCard = {
  chatModels: [],
  description:
    'LiteLLM is an open-source gateway that gives one OpenAI-compatible API for 100+ model providers, with virtual keys, spend tracking, budgets, and fallbacks.',
  id: 'litellm',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.litellm.ai/docs/proxy/quick_start',
  name: 'LiteLLM',
  settings: {
    proxyUrl: {
      placeholder: 'http://localhost:4000/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://docs.litellm.ai',
};

export default LiteLLM;
