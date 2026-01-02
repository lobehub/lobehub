import { type ModelProviderCard } from '@/types/llm';

// ref: https://platform.moonshot.cn/docs/intro#模型列表
const Moonshot: ModelProviderCard = {
  chatModels: [],
  checkModel: 'kimi-latest',
  description:
    'Moonshot, from Moonshot AI (Beijing Moonshot Technology), offers multiple NLP models for use cases like content creation, research, recommendations, and medical analysis, with strong long-context and complex generation support.',
  id: 'moonshot',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.moonshot.cn/docs/intro',
  name: 'Moonshot',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://api.moonshot.cn/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.moonshot.cn',
};

export default Moonshot;
