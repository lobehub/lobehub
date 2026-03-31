import type { ModelProviderCard } from '@/types/llm';

// ref: https://docs.z.ai/devpack/overview
const GLMCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'GLM-4.7',
  description:
    'GLM Coding Plan provides access to Zhipu AI models including GLM-5 and GLM-4.7 for coding tasks via a fixed-fee subscription.',
  disableBrowserRequest: true,
  id: 'glmcodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://docs.z.ai/devpack/overview',
  name: 'GLM Coding Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.z.ai/api/paas/v4',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://z.ai/subscribe',
};

export default GLMCodingPlan;
