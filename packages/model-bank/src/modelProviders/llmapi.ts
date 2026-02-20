import type { ModelProviderCard } from '@/types/llm';

// ref: https://llmapi.ai
const LLMAPI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'openai/gpt-4o-mini',
  description:
    'LLM API is an OpenAI-compatible gateway that provides access to 100+ models from multiple vendors including OpenAI, Anthropic, Google, Meta, Mistral, and more through a single unified API.',
  id: 'llmapi',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://llmapi.ai',
  name: 'LLM API',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.llmapi.ai/v1',
    },
    sdkType: 'openai',
    searchMode: 'params',
    showModelFetcher: true,
  },
  url: 'https://llmapi.ai',
};

export default LLMAPI;
