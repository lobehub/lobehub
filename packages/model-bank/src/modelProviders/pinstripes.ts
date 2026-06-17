import type { ModelProviderCard } from '@/types/llm';

// ref: https://pinstripes.io
const Pinstripes: ModelProviderCard = {
  chatModels: [],
  checkModel: 'ps/deepseek-v4-flash',
  description:
    'Pinstripes is an OpenAI-compatible inference API offering high-quality models at competitive prices, including DeepSeek, GLM, Qwen, and MiniMax variants.',
  id: 'pinstripes',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://pinstripes.io',
  name: 'Pinstripes',
  settings: {
    proxyUrl: {
      placeholder: 'https://pinstripes.io/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://pinstripes.io',
};

export default Pinstripes;
