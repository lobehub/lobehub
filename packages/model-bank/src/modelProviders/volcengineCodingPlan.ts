import type { ModelProviderCard } from '@/types/llm';

// ref: https://www.volcengine.com/docs/82379/1925114
const VolcengineCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'doubao-seed-code',
  description:
    'Volcengine Coding Plan from ByteDance provides access to multiple coding models including Doubao-Seed-Code, GLM-4.7, DeepSeek-V3.2, and Kimi-K2.5 via a fixed-fee subscription.',
  disableBrowserRequest: true,
  id: 'volcenginecodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://www.volcengine.com/docs/82379/1925114',
  name: 'Volcengine Coding Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://www.volcengine.com/activity/codingplan',
};

export default VolcengineCodingPlan;
