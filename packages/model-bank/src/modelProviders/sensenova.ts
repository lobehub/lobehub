import type { ModelProviderCard } from '@/types/llm';

// ref https://platform.sensenova.cn/pricing
// ref https://platform.sensenova.cn/release?path=/release-202409.md
const SenseNova: ModelProviderCard = {
  chatModels: [],
  checkModel: 'SenseChat-Turbo',
  description:
    'SenseNova delivers efficient, easy-to-use full-stack LLM services backed by SenseTime infrastructure.',
  disableBrowserRequest: true,
  id: 'sensenova',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.sensenova.cn/pricing',
  name: 'SenseNova',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.sensenova.cn/compatible-mode/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://platform.sensenova.cn/home',
};

export default SenseNova;
