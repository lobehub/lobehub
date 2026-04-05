import type { ModelProviderCard } from '@/types/llm';

const Chuizi: ModelProviderCard = {
  apiKeyUrl: 'https://chuizi.ai/console/keys',
  chatModels: [],
  checkModel: 'anthropic/claude-haiku-4-5',
  description:
    'Chuizi.AI is a unified AI gateway providing access to 100+ models across 17 providers through a single OpenAI-compatible endpoint, with native Anthropic Messages API and Gemini API support.',
  id: 'chuizi',
  modelsUrl: 'https://chuizi.ai/models',
  name: 'Chuizi.AI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.chuizi.ai/v1',
    },
    sdkType: 'router',
    showModelFetcher: true,
  },
  url: 'https://chuizi.ai',
};

export default Chuizi;
