import type { ModelProviderCard } from '@/types/llm';

// ref: https://tokenmix.ai/models
const TokenMix: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek/deepseek-v4-flash',
  description:
    'TokenMix is an OpenAI-compatible API gateway that provides unified access to many large language models — including DeepSeek, Qwen, Kimi, GLM, and MiniMax — through a single endpoint and one API key, with pay-as-you-go pricing.',
  disableBrowserRequest: true,
  id: 'tokenmix',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://tokenmix.ai/models',
  name: 'TokenMix',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.tokenmix.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://tokenmix.ai',
};

export default TokenMix;
