import type { ModelProviderCard } from '@/types/llm';

// ref: https://www.orcarouter.ai/models
const OrcaRouter: ModelProviderCard = {
  chatModels: [],
  checkModel: 'orcarouter/auto',
  description:
    'OrcaRouter is an adaptive LLM router that picks the best upstream per request using a LinUCB contextual bandit over cost, latency, and quality signals — one API key, 150+ frontier models from OpenAI, Anthropic, Google, DeepSeek, xAI and more.',
  id: 'orcarouter',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://www.orcarouter.ai/models',
  name: 'OrcaRouter',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.orcarouter.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.orcarouter.ai',
};

export default OrcaRouter;
