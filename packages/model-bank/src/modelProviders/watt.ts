import type { ModelProviderCard } from '../types';

// ref: https://www.watt-cloud.com/docs/
const Watt: ModelProviderCard = {
  chatModels: [],
  checkModel: 'GLM-5.3-Flash',
  description:
    'Watt Cloud provides access to the DeepSeek, GLM, Hunyuan, Kimi, MiniMax, and Qwen3.5 model families through a single OpenAI-compatible API.',
  enabled: true,
  id: 'watt',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://api.watt-cloud.com/v1/models',
  name: 'Watt Cloud',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.watt-cloud.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.watt-cloud.com',
};

export default Watt;
