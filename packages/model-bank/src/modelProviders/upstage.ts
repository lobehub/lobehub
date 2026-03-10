import type { ModelProviderCard } from '@/types/llm';

// ref :https://developers.upstage.ai/docs/getting-started/models
const Upstage: ModelProviderCard = {
  chatModels: [],
  checkModel: 'solar-1-mini-chat',
  description:
    'Upstage builds AI models for business needs, including Solar LLM and Document AI, with chat APIs that support function calling, translation, embeddings, and domain-specific use cases.',
  id: 'upstage',
  modelsUrl: 'https://developers.upstage.ai/docs/getting-started/models',
  name: 'Upstage',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.upstage.ai/v1/solar',
    },
    sdkType: 'openai',
  },
  url: 'https://upstage.ai',
};

export default Upstage;
