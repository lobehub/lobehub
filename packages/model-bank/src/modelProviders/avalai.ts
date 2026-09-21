import type { ModelProviderCard } from '../types';

// ref: https://docs.avalai.ir
const AvalAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description:
    'AvalAI is an OpenAI-compatible AI gateway that provides unified access to frontier models from OpenAI, Anthropic, Google, Meta, Mistral, Qwen, DeepSeek, and more through a single API.',
  id: 'avalai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.avalai.ir',
  name: 'AvalAI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.avalai.ir/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://avalai.ir',
};

export default AvalAI;
