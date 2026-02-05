import type { ModelProviderCard } from '@/types/llm';

// ref https://developers.cloudflare.com/workers-ai/models/#text-generation
// api https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility
const Cloudflare: ModelProviderCard = {
  chatModels: [],
  checkModel: '@hf/meta-llama/meta-llama-3-8b-instruct',
  description: 'Run serverless GPU-powered ML models across Cloudflare’s global network.',
  disableBrowserRequest: true,
  id: 'cloudflare',
  modelList: {
    showModelFetcher: true,
  },
  name: 'Cloudflare Workers AI',
  settings: {
    disableBrowserRequest: true,
    sdkType: 'cloudflare',
    showModelFetcher: true,
  },
  url: 'https://developers.cloudflare.com/workers-ai/models',
};

export default Cloudflare;
