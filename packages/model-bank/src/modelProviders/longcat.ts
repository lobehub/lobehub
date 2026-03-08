import { type ModelProviderCard } from '@/types/llm';

const LongCat: ModelProviderCard = {
  chatModels: [],
  checkModel: 'LongCat-Flash-Lite',
  description:
    'LongCat is a series of generative AI large models independently developed by Meituan. It is designed to enhance internal enterprise productivity and enable innovative applications through an efficient computational architecture and strong multimodal capabilities.',
  id: 'longcat',
  modelsUrl: 'https://longcat.chat/platform/docs/zh/#%E6%94%AF%E6%8C%81%E7%9A%84%E6%A8%A1%E5%9E%8B',
  name: 'LongCat',
  settings: {
    disableBrowserRequest: false,
    proxyUrl: {
      placeholder: 'https://api.longcat.chat/openai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: false,
  },
  url: 'https://longcat.chat/platform/usage',
};

export default LongCat;
