import type { ModelProviderCard } from '@/types/llm';

// ref: https://www.eurouter.ai/docs
const EUrouter: ModelProviderCard = {
  chatModels: [],
  checkModel: 'mistral-large-latest',
  description:
    'EUrouter is a European AI Gateway providing a single OpenAI-compatible API endpoint to EU-hosted, GDPR-friendly AI models with smart routing, safe fallbacks, and observability.',
  id: 'eurouter',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://www.eurouter.ai/docs',
  name: 'EUrouter',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.eurouter.ai/api/v1',
    },
    sdkType: 'openai',
    searchMode: 'params',
    showModelFetcher: true,
  },
  url: 'https://www.eurouter.ai',
};

export default EUrouter;
