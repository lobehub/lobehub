import type { ModelProviderCard } from '../types';

// NOTE: The chatModels list below is currently incomplete. Only a subset of
// available models has been added so far. The remaining model cards need to be
// filled in later or with help from others who have access to the full model
// lineup. See https://docs.volcengine.com/docs/82379/2366394 for reference.

// ref: https://docs.volcengine.com/docs/82379/2366394
const VolcengineAgentPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'doubao-seed-2.0-mini',
  description:
    'Volcengine Agent Plan from ByteDance provides access to multiple coding models including Doubao-Seed-2.0, GLM-5.2, DeepSeek-V4, and Kimi-K3 etc.',
  disableBrowserRequest: true,
  id: 'volcengineagentplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://docs.volcengine.com/docs/82379/2366394',
  name: 'Volcengine Agent Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://www.volcengine.com/activity/agentplan',
};

export default VolcengineAgentPlan;
