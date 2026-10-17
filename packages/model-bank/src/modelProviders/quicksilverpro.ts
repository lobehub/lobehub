import type { ModelProviderCard } from '../types';

const QuickSilverPro: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-6.1-sol',
  description:
    'QuickSilver Pro is an OpenAI-compatible AI gateway operated by MachineFi Inc. (US), serving models from multiple providers through a unified API.',
  id: 'quicksilverpro',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://quicksilverpro.io/pricing/',
  name: 'QuickSilver Pro',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.quicksilverpro.io/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://quicksilverpro.io',
};

export default QuickSilverPro;
