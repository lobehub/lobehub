import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.stepfun.com/docs/zh/step-plan/overview
const StepFunCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'step-3.5-flash',
  description:
    'Step Plan provides access to StepFun models including Step 3.5 Flash for coding tasks via a fixed-fee subscription.',
  disableBrowserRequest: true,
  id: 'stepfuncodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://platform.stepfun.com/docs/zh/step-plan/overview',
  name: 'Step Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.stepfun.com/step_plan/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://platform.stepfun.com/step-plan',
};

export default StepFunCodingPlan;
