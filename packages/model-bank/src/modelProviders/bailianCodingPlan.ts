import type { ModelProviderCard } from '@/types/llm';

// ref: https://help.aliyun.com/zh/model-studio/coding-plan-overview
const BailianCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'qwen3-coder-plus',
  description:
    'Aliyun Bailian Coding Plan is a specialized AI coding service providing access to coding-optimized models from Qwen, GLM, Kimi, and MiniMax via a dedicated endpoint.',
  disableBrowserRequest: true,
  id: 'bailiancodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan-overview',
  name: 'Aliyun Bailian Coding Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://coding.dashscope.aliyuncs.com/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://help.aliyun.com/zh/model-studio/coding-plan-overview',
};

export default BailianCodingPlan;
