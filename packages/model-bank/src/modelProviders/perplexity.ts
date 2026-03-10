import type { ModelProviderCard } from '@/types/llm';

// ref :https://docs.perplexity.ai/docs/model-cards
const Perplexity: ModelProviderCard = {
  chatModels: [],
  checkModel: 'sonar',
  description:
    'Perplexity provides advanced chat models, including Llama 3.1 variants, for online and offline use and complex NLP workloads.',
  id: 'perplexity',
  modelsUrl: 'https://docs.perplexity.ai/guides/model-cards',
  name: 'Perplexity',
  settings: {
    // perplexity doesn't support CORS
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.perplexity.ai',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
  },
  url: 'https://www.perplexity.ai',
};

export default Perplexity;
