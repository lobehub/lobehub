import type { ModelProviderCard } from '../types';

// ref: https://proxystacks.com/en/docs
const ProxyStacks: ModelProviderCard = {
  apiKeyUrl: 'https://proxystacks.com/login',
  chatModels: [],
  checkModel: 'deepseek-v4.1-flash',
  description:
    'ProxyStacks Relay provides unified OpenAI, Responses, and Anthropic compatible access to frontier models from OpenAI, Anthropic, DeepSeek, Zhipu, Moonshot, and Qwen with low-latency global and APAC routing.',
  id: 'proxystacks',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://proxystacks.com/en/models',
  name: 'ProxyStacks',
  settings: {
    proxyUrl: {
      placeholder: 'https://proxystacks.com/v1',
    },
    sdkType: 'router',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://proxystacks.com',
};

export default ProxyStacks;
