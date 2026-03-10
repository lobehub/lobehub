import type { ModelProviderCard } from '@/types/llm';

const Search1API: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-r1-70b-fast-online',
  description:
    'Search1API provides access to DeepSeek models with optional web connectivity, including standard and fast variants across multiple parameter sizes.',
  id: 'search1api',
  modelList: { showModelFetcher: true },
  name: 'Search1API',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.search1api.com/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.search1api.com',
};

export default Search1API;
