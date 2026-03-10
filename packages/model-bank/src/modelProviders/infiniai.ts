import type { ModelProviderCard } from '@/types/llm';

// https://cloud.infini-ai.com/genstudio/model
// All models are currently free
const InfiniAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'qwen3-8b',
  description:
    'Provides app developers with high-performance, easy-to-use, secure LLM services across the full workflow from model development to production deployment.',
  id: 'infiniai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://cloud.infini-ai.com/genstudio/model',
  name: 'InfiniAI',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://cloud.infini-ai.com/maas/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://cloud.infini-ai.com/genstudio',
};

export default InfiniAI;
