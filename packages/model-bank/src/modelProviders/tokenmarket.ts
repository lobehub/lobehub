import type { ModelProviderCard } from '../types';

const TokenMarket: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-5.4-mini',
  description:
    'Token Market provides unified access to models from OpenAI, Anthropic, Google, DeepSeek, Qwen, GLM, MiniMax, and more through an OpenAI-compatible API with smart routing and failover.',
  id: 'tokenmarket',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://www.tokensmarket.ai/models',
  name: 'Token Market',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.tokensmarket.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.tokensmarket.ai',
};

export default TokenMarket;
