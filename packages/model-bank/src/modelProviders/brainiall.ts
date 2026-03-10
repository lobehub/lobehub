import type { ModelProviderCard } from '@/types/llm';

const Brainiall: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-haiku-4-5',
  description:
    'Brainiall provides access to 33 AI models including Claude, DeepSeek, Llama, Qwen, Mistral, and more through a single OpenAI-compatible API. Get started at app.brainiall.com.',
  id: 'brainiall',
  modelsUrl: 'https://app.brainiall.com',
  name: 'Brainiall',
  settings: {
    proxyUrl: {
      placeholder: 'https://apim-ai-apis.azure-api.net/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://brainiall.com',
};

export default Brainiall;
