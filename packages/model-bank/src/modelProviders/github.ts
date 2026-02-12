import type { ModelProviderCard } from '@/types/llm';

// ref: https://github.com/marketplace/models
const Github: ModelProviderCard = {
  chatModels: [],
  checkModel: 'microsoft/Phi-3-mini-4k-instruct',
  // Ref: https://github.blog/news-insights/product-news/introducing-github-models/
  description:
    'With GitHub Models, developers can build as AI engineers using industry-leading models.',
  id: 'github',
  modelList: { showModelFetcher: true },
  // I'm not sure if it is good to show the model fetcher, as remote list is not complete.
  name: 'GitHub',
  settings: {
    sdkType: 'azure',
    showModelFetcher: true,
  },
  url: 'https://github.com/marketplace/models',
};

export default Github;
