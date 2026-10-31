import type { ModelProviderCard } from '@/types/llm';

// ref: https://futurmix.ai
const FuturMix: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o',
  description:
    'FuturMix is a unified AI gateway providing access to 22+ models (Claude, GPT, Gemini) through a single OpenAI-compatible API with 99.99% SLA and competitive pricing.',
  id: 'futurmix',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://futurmix.ai',
  name: 'FuturMix',
  settings: {
    proxyUrl: {
      placeholder: 'https://futurmix.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://futurmix.ai',
};

export default FuturMix;
