import type { ModelProviderCard } from '@/types/llm';

// ref: https://novita.ai/model-api/product/llm-api
const Novita: ModelProviderCard = {
  chatModels: [],
  checkModel: 'meta-llama/llama-3.1-8b-instruct',
  description:
    'Novita AI offers flexible, reliable, cost-effective APIs for LLMs and image generation. It supports models like Llama 3 and Mistral and provides scalable, developer-friendly APIs for generative AI startups.',
  disableBrowserRequest: true,
  id: 'novita',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://novita.ai/model-api/product/llm-api',
  name: 'Novita',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.novita.ai/v3/openai',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://novita.ai',
};

export default Novita;
