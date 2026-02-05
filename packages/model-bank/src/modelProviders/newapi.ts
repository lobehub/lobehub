import type { ModelProviderCard } from '@/types/llm';

const NewAPI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description: 'An open-source aggregation and routing platform for multiple AI services.',
  enabled: true,
  id: 'newapi',
  name: 'New API',
  settings: {
    proxyUrl: {
      placeholder: 'https://your.new-api-provider.com',
    },
    sdkType: 'router',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://github.com/Calcium-Ion/new-api',
};

export default NewAPI;
