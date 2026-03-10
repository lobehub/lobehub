import type { ModelProviderCard } from '@/types/llm';

// ref: https://modelscope.cn/docs/model-service/API-Inference/intro
const ModelScope: ModelProviderCard = {
  chatModels: [],
  checkModel: 'Qwen/Qwen3-4B',
  description:
    'ModelScope is Alibaba Cloud’s model-as-a-service platform, offering a wide range of AI models and inference services.',
  id: 'modelscope',
  modelList: { showModelFetcher: true },
  name: 'ModelScope',
  settings: {
    disableBrowserRequest: true, // CORS Error
    proxyUrl: {
      placeholder: 'https://api-inference.modelscope.cn/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://modelscope.cn',
};

export default ModelScope;
