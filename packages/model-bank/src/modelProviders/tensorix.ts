import type { ModelProviderCard } from '@/types/llm';

const Tensorix: ModelProviderCard = {
  chatModels: [],
  checkModel: 'meta-llama/llama-3.3-70b-instruct',
  description:
    'Tensorix provides affordable access to top open-source AI models through an OpenAI-compatible API, with competitive pricing and fast inference.',
  id: 'tensorix',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://tensorix.ai/models',
  name: 'Tensorix',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.tensorix.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://tensorix.ai',
};

export default Tensorix;
