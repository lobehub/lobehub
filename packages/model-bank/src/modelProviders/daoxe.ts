import type { ModelProviderCard } from '@/types/llm';

const DaoXE: ModelProviderCard = {
  apiKeyUrl: 'https://daoxe.com/keys',
  chatModels: [],
  checkModel: 'gemini-2.5-flash',
  description:
    'DaoXE provides access to models from OpenAI, Anthropic, Google, xAI, DeepSeek, and more through a unified OpenAI-compatible API.',
  id: 'daoxe',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://daoxe.com/pricing',
  name: 'DaoXE',
  settings: {
    proxyUrl: {
      placeholder: 'https://daoxe.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://daoxe.com',
};

export default DaoXE;
