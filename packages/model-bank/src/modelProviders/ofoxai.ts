import type { ModelProviderCard } from '@/types/llm';

const OfoxAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description:
    'OfoxAI is a unified API gateway for 100+ LLM models (Claude, GPT, Gemini, DeepSeek, etc.) with a single API key. OpenAI-compatible format.',
  id: 'ofoxai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.ofox.ai/zh/api',
  name: 'OfoxAI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.ofox.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://ofox.ai',
};

export default OfoxAI;
