import type { ModelProviderCard } from '../types';

const GitGot: ModelProviderCard = {
  chatModels: [],
  checkModel: 'openai/gpt-oss-120b',
  description:
    'GitGot is an OpenAI-compatible endpoint serving open-weight models, including several with few other providers — Kimi K2.7 Code, Kimi K2.6, DeepSeek V4 Pro and Flash, gpt-oss-120b and Llama 3.3 70B.',
  id: 'gitgot',
  modelsUrl: 'https://inference.gitgot.ai/v1/models',
  name: 'GitGot',
  settings: {
    proxyUrl: {
      placeholder: 'https://inference.gitgot.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://gitgot.ai',
};

export default GitGot;
