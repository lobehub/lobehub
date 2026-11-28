import { type ModelProviderCard } from '../types';

// ref: https://docs.runanywhere.ai/wally-cloud/api
const Wally: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4.1-flash',
  description:
    'Wally by RunAnywhere serves open-weight models such as DeepSeek, GLM, Kimi and MiniMax through an OpenAI-compatible API.',
  id: 'wally',
  modelsUrl: 'https://www.runwally.com/pricing',
  name: 'Wally',
  settings: {
    proxyUrl: {
      placeholder: 'https://inference.runanywhere.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.runwally.com',
};

export default Wally;
