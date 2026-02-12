import type { ModelProviderCard } from '@/types/llm';

// ref https://cloud.tencent.com/document/product/1729/104753
const Hunyuan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'hunyuan-t1-latest',
  description:
    'A Tencent-developed LLM with strong Chinese writing, solid reasoning in complex contexts, and reliable task execution.',
  disableBrowserRequest: true,
  id: 'hunyuan',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://cloud.tencent.com/document/product/1729/104753',
  name: 'Hunyuan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.hunyuan.cloud.tencent.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://hunyuan.tencent.com',
};

export default Hunyuan;
