import type { ModelProviderCard } from '@/types/llm';

const ZhiPu: ModelProviderCard = {
  chatModels: [],
  checkModel: 'glm-4.5-flash',
  description:
    'ZhiPu AI provides an open platform for multimodal and language models across text processing, image understanding, and coding assistance.',
  id: 'zhipu',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://open.bigmodel.cn/dev/howuse/model',
  name: 'ZhiPu',
  settings: {
    proxyUrl: {
      placeholder: 'https://open.bigmodel.cn/api/paas/v4',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://zhipuai.cn',
};

export default ZhiPu;
