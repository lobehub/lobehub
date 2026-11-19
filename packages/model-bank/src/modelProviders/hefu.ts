import type { ModelProviderCard } from '../types';

// ref: https://www.hefu.hk
const HeFu: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4-flash',
  description:
    'HeFu is an AI API aggregation gateway based in Hong Kong, offering unified OpenAI-compatible access to GPT, Claude, Gemini, DeepSeek, Kimi, Qwen, GLM, MiniMax, Grok and more with pay-as-you-go USD billing.',
  enabled: true,
  id: 'hefu',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://api.hefu.hk/v1/models',
  name: 'HeFu',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.hefu.hk/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.hefu.hk',
};

export default HeFu;
