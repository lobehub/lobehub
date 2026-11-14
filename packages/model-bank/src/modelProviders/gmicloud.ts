import type { ModelProviderCard } from '../types';

const GMICloud: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-ai/DeepSeek-V4-Flash',
  description:
    'GMI Cloud is a GPU cloud with a serverless inference API for leading open models like DeepSeek, Qwen, GLM, Kimi and MiniMax.',
  id: 'gmicloud',
  modelsUrl: 'https://www.gmicloud.ai/model-library',
  name: 'GMI Cloud',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.gmi-serving.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.gmicloud.ai',
};

export default GMICloud;
