import type { ModelProviderCard } from '@/types/llm';

const Brainiall: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-haiku-4-5',
  description:
    'Brainiall is an LLM Gateway providing access to 113+ models from 17 providers including Claude, DeepSeek, Llama, Qwen, Mistral, and more, all through a single OpenAI-compatible API powered by AWS Bedrock.',
  id: 'brainiall',
  modelsUrl: 'https://brainiall.com',
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
