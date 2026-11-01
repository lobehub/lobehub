import type { ModelProviderCard } from '../types';

const Moonshot: ModelProviderCard = {
  chatModels: [],
  // kimi-k2.5 is closed to new accounts since the K3 launch (fully retired on
  // 2026-08-31), which would fail connectivity checks for new API keys
  checkModel: 'kimi-k2.6',
  description:
    'Moonshot, from Moonshot AI (Beijing Moonshot Technology), offers multiple NLP models for use cases like content creation, research, recommendations, and medical analysis, with strong long-context and complex generation support.',
  id: 'moonshot',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.moonshot.ai/docs/pricing/chat',
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
  url: 'https://www.moonshot.ai/',
};

export default Moonshot;
