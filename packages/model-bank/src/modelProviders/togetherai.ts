import type { ModelProviderCard } from '@/types/llm';

// ref: https://docs.together.ai/docs/chat-models
// ref: https://www.together.ai/pricing
const TogetherAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'meta-llama/Llama-Vision-Free',
  description:
    'Together AI delivers leading performance with innovative models, broad customization, rapid scaling, and straightforward deployment for enterprise needs.',
  id: 'togetherai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.together.ai/docs/chat-models',
  name: 'Together AI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.together.xyz/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.together.ai',
};

export default TogetherAI;
