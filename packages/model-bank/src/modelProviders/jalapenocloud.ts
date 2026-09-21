import type { ModelProviderCard } from '../types';

const JalapenoCloud: ModelProviderCard = {
  chatModels: [],
  checkModel: 'DeepSeek-V4-Pro',
  description:
    'Jalapeno Cloud 50%off is an enterprise-grade AI inference platform with an OpenAI-compatible API, offering models from DeepSeek, Zhipu, MiniMax, Kimi, Qwen, and more.',
  id: 'jalapenocloud',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://www.jalapeno-cloud.ai/models',
  name: 'Jalapeno Cloud 50%off',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.jalapeno-cloud.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.jalapeno-cloud.ai',
};

export default JalapenoCloud;
