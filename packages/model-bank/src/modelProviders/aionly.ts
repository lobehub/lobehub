import type { ModelProviderCard } from '@/types/llm';

import { aionlyChatModels } from '../aiModels/aionly';

const AiOnly: ModelProviderCard = {
  chatModels: aionlyChatModels,
  checkModel: 'gpt-4o-mini',
  description: 'AiOnly 一站式大模型 API 平台，聚合全球主流 AI 模型，提供统一接口服务，快速构建智能应用。',
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
