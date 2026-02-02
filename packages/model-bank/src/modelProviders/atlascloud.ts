import { type ModelProviderCard } from '@/types/llm';

// ref: https://api.atlascloud.ai
const AtlasCloud: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description:
    'Atlas Cloud provides unified access to multiple AI models through a single OpenAI-compatible API, supporting various model providers and capabilities.',
  id: 'atlascloud',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://atlascloud.ai/models',
  name: 'Atlas Cloud',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.atlascloud.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://atlascloud.ai',
};

export default AtlasCloud;
