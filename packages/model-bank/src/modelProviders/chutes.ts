import type { ModelProviderCard } from '@/types/llm';

// ref https://chutes.ai
const Chutes: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-ai/DeepSeek-V3-0324',
  description:
    'Chutes AI provides decentralized AI inference on Bittensor Subnet 64. All models run in Trusted Execution Environments (TEE), ensuring privacy and security for every inference.',
  id: 'chutes',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://chutes.ai/app/chute?type=llm',
  name: 'Chutes AI',
  settings: {
    proxyUrl: {
      placeholder: 'https://llm.chutes.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://chutes.ai',
};

export default Chutes;
