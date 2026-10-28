import type { ModelProviderCard } from '../types';

// ref: https://fikraapi.co.ke/models
const Fikra: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4.1-flash',
  description:
    'Fikra API is an OpenAI-compatible inference service serving open-weight models (DeepSeek, GLM, Kimi, Qwen) with per-token billing in USD and M-Pesa, mobile money or card payments.',
  id: 'fikra',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://api.fikraapi.co.ke/v1/models',
  name: 'Fikra',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.fikraapi.co.ke/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://fikraapi.co.ke',
};

export default Fikra;
