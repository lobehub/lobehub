import type { ModelProviderCard } from '@/types/llm';

import { aionlyChatModels } from '../aiModels/aionly';

const AiOnly: ModelProviderCard = {
  chatModels: aionlyChatModels,
  checkModel: 'gpt-4o-mini',
  description:
    'AiOnly is an OpenAI-compatible model aggregation platform that provides unified access to mainstream AI models for building intelligent applications quickly.',
  id: 'aionly',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://maas.aionly.com/document?from=https%3A%2F%2Faionly.com',
  name: 'AiOnly',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.aionly.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://aionly.com',
};

export default AiOnly;
