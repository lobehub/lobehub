import type { ModelProviderCard } from '../types';

// ref: https://docs.z.ai/devpack/overview
const GLMCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'glm-5.2',
  description:
    'GLM Coding Plan provides access to Zhipu AI models including GLM-5.2, GLM-5.1, and GLM-4.7 for coding tasks via a fixed-fee subscription.',
  disableBrowserRequest: true,
  id: 'glmcodingplan',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
  name: 'GLM Coding Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://open.bigmodel.cn/api/coding/paas/v4',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: true,
  },
  url: 'https://z.ai/subscribe',
};

export default GLMCodingPlan;
