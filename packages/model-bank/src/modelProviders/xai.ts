import type { ModelProviderCard } from '@/types/llm';

// ref: https://x.ai/about
const XAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'grok-4-1-fast-non-reasoning',
  description:
    'xAI builds AI to accelerate scientific discovery, with a mission to deepen humanity’s understanding of the universe.',
  id: 'xai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.x.ai/docs#models',
  name: 'xAI (Grok)',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.x.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://x.ai/api',
};

export default XAI;
