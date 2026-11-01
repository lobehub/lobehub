import type { ModelProviderCard } from '../types';

const SenseNova: ModelProviderCard = {
  chatModels: [],
  checkModel: 'sensenova-6.7-flash-lite',
  description:
    'SenseNova delivers efficient, easy-to-use full-stack LLM services backed by SenseTime infrastructure.',
  id: 'sensenova',
  modelsUrl: 'https://www.sensenova.cn/models',
  name: 'SenseNova',
  settings: {
    //disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://token.sensenova.cn/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://platform.sensenova.cn',
};

export default SenseNova;
