import type { ModelProviderCard } from '@/types/llm';

// ref https://cloud.tencent.com/document/product/1729/104753
const Hunyuan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'hunyuan-role-latest',
  description:
    'A Tencent-developed LLM with strong Chinese writing, solid reasoning in complex contexts, and reliable task execution.',
  disableBrowserRequest: true,
  id: 'hunyuan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://console.cloud.tencent.com/tokenhub/models',
  name: 'Hunyuan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://tokenhub.tencentmaas.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: false,
  },
  url: 'https://hunyuan.tencent.com',
};

export default Hunyuan;
