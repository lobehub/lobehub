import type { ModelProviderCard } from '../types';

// ref: https://mizumi.co/docs
const Mizumi: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4.1-mini',
  description:
    'Mizumi is an OpenAI-compatible API gateway that serves OpenAI and Gemini models through official API channels behind a single endpoint and one API key.',
  disableBrowserRequest: true,
  id: 'mizumi',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://mizumi.co/docs',
  name: 'Mizumi',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.mizumi.co/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://mizumi.co',
};

export default Mizumi;
