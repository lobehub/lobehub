import type { ModelProviderCard } from '@/types/llm';

// ref: https://api.cometapi.com/pricing
const CometAPI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-5-mini',
  description:
    'CometAPI provides access to frontier models from OpenAI, Anthropic, Google, and more, letting users choose the best model and pricing for diverse use cases.',
  enabled: true,
  id: 'cometapi',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://api.cometapi.com/v1/models',
  name: 'CometAPI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.cometapi.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://cometapi.com',
};

export default CometAPI;
