import type { ModelProviderCard } from '../types';

// ref: https://thegrid.ai/docs/instrument-specifications/current-instruments
const TheGrid: ModelProviderCard = {
  chatModels: [],
  checkModel: 'text-standard',
  description:
    'The Grid is an inference marketplace that serves models from several labs behind one OpenAI-compatible API, addressing capability tiers rather than a specific model name.',
  id: 'thegrid',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://api.thegrid.ai/v1/models',
  name: 'The Grid',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.thegrid.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://thegrid.ai',
};

export default TheGrid;
