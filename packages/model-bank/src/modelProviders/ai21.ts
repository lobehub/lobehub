import type { ModelProviderCard } from '@/types/llm';

// ref https://docs.ai21.com/reference/jamba-15-api-ref
const Ai21: ModelProviderCard = {
  chatModels: [],
  checkModel: 'jamba-mini',
  description:
    'AI21 Labs builds foundation models and AI systems for enterprises, accelerating generative AI in production.',
  id: 'ai21',
  modelsUrl: 'https://docs.ai21.com/reference',
  name: 'Ai21Labs',
  settings: {
    sdkType: 'openai',
  },
  url: 'https://studio.ai21.com',
};

export default Ai21;
