import type { ModelProviderCard } from '@/types/llm';

// ref: https://help.aliyun.com/zh/model-studio/getting-started/models
const Qwen: ModelProviderCard = {
  chatModels: [],
  checkModel: 'qwen-flash',
  description:
    "Qwen is Alibaba Cloud's large-scale language model with strong understanding and generation, covering Q&A, writing, opinion expression, and code across many domains.",
  disableBrowserRequest: true,
  id: 'qwen',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://help.aliyun.com/zh/dashscope/developer-reference/api-details',
  name: 'Aliyun Bailian',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: true,
  },
  url: 'https://www.aliyun.com/product/bailian',
};

export default Qwen;
