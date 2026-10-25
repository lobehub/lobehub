import type { ModelProviderCard } from '@/types/llm';

// ref: https://docs.ofox.ai
const OfoxAI: ModelProviderCard = {
  apiKeyUrl: 'https://app.ofox.ai',
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description:
    'OfoxAI is a unified LLM API gateway that provides access to 100+ models — including OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Qwen, Mistral, and Llama — through a single API key. Wire-compatible with the OpenAI, Anthropic, and Gemini protocols.',
  id: 'ofoxai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.ofox.ai',
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
