import type { ModelProviderCard } from '../types';

// ref: https://crowllm.com/docs
const CrowLLM: ModelProviderCard = {
  apiKeyUrl: 'https://crowllm.com',
  chatModels: [],
  checkModel: 'deepseek-v4-flash',
  description:
    'OpenAI-compatible gateway with one key for every model, plus a zero-rated free model shelf.',
  id: 'crowllm',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://crowllm.com/docs',
  name: 'CrowLLM',
  settings: {
    proxyUrl: {
      placeholder: 'https://crowllm.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://crowllm.com',
};

export default CrowLLM;
