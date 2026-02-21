import type { ModelProviderCard } from '@/types/llm';

const Moonshot: ModelProviderCard = {
  chatModels: [],
  checkModel: 'kimi-latest',
  description:
    'Moonshot, from Moonshot AI (Beijing Moonshot Technology), offers multiple NLP models for use cases like content creation, research, recommendations, and medical analysis, with strong long-context and complex generation support.',
  id: 'moonshot',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.moonshot.ai/docs/pricing/chat',
  name: 'Moonshot',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://api.moonshot.ai/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.moonshot.ai/',
};

export default Moonshot;
