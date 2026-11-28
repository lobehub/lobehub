import type { ModelProviderCard } from '../types';

// MartLLM is a marketplace: each request is served by a third-party provider
// for the requested model, behind one OpenAI-compatible endpoint. It is not the
// official API of any model maker. The model list changes with what sellers
// offer, so it is fetched from /v1/models rather than kept in full here.
// ref: https://martllm.com/docs/quickstart
const MartLLM: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek/deepseek-v3.2',
  description:
    'MartLLM is a marketplace of third-party model providers behind one OpenAI-compatible API, with prepaid credit and no subscription.',
  id: 'martllm',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://martllm.com/models',
  name: 'MartLLM',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.martllm.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://martllm.com',
};

export default MartLLM;
