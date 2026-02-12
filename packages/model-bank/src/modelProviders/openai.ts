import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.openai.com/docs/deprecations
const OpenAI: ModelProviderCard = {
  apiKeyUrl: 'https://platform.openai.com/api-keys?utm_source=lobehub',
  chatModels: [],
  checkModel: 'gpt-5.2',
  description:
    'OpenAI is a leading AI research lab whose GPT models advanced natural language processing, delivering high performance and strong value across research, business, and innovation.',
  enabled: true,
  id: 'openai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.openai.com/docs/models',
  name: 'OpenAI',
  settings: {
    responseAnimation: 'smooth',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://openai.com',
};

export default OpenAI;
