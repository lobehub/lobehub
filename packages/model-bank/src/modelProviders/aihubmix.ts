import type { ModelProviderCard } from '@/types/llm';

const AiHubMix: ModelProviderCard = {
  apiKeyUrl: 'https://lobe.li/9mZhb4T',
  chatModels: [],
  checkModel: 'gpt-4.1-nano',
  description: 'AiHubMix provides access to multiple AI models through a unified API.',
  id: 'aihubmix',
  modelsUrl: 'https://docs.aihubmix.com/cn/api/Model-List',
  name: 'AiHubMix',
  settings: {
    sdkType: 'router',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://aihubmix.com?utm_source=lobehub',
};

export default AiHubMix;
