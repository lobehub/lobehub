import type { ModelProviderCard } from '@/types/llm';

// ref: https://docs.edenai.co
const EdenAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'mistral/mistral-small-latest',
  description:
    'Eden AI provides unified, OpenAI-compatible access to 100+ models from many providers (OpenAI, Anthropic, Google, Mistral, DeepSeek, and more) through a single EU-hosted endpoint and API key.',
  id: 'edenai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://www.edenai.co/product/models',
  name: 'Eden AI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.edenai.run/v3',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.edenai.co',
};

export default EdenAI;
