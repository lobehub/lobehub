import { type ModelProviderCard } from '@/types/llm';

const LlmApi: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description:
    'LLM API provides a unified OpenAI-compatible gateway to a wide range of language models, enabling developers to seamlessly integrate and switch between diverse AI models with a single API endpoint.',
  id: 'llmapi',
  modelsUrl: 'https://docs.llmapi.ai',
  name: 'LLM API',
  settings: {
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://llmapi.ai',
};

export default LlmApi;
