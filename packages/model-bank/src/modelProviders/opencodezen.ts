import type { ModelProviderCard } from '@/types/llm';

const OpenCodeZen: ModelProviderCard = {
  apiKeyUrl: 'https://opencode.ai/auth',
  chatModels: [],
  checkModel: 'gpt-5.4-mini',
  description:
    'OpenCode Zen is a curated list of models tested and verified for coding agents, provided by the OpenCode team.',
  id: 'opencodezen',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://opencode.ai/zen/v1/models',
  name: 'OpenCode Zen',
  settings: {
    proxyUrl: {
      placeholder: 'https://opencode.ai/zen/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://opencode.ai/zen',
};

export default OpenCodeZen;
