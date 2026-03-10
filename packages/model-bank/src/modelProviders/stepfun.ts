import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.stepfun.com/docs/llm/text
// According to the documentation, for Stepfun models, the 'k' in context length refers to 1000
const Stepfun: ModelProviderCard = {
  chatModels: [],
  checkModel: 'step-2-mini',
  description:
    'Stepfun models offer leading multimodal and complex reasoning capabilities, with long-context understanding and powerful autonomous search orchestration.',
  // after test, currently https://api.stepfun.com/v1/chat/completions has the CORS issue
  // So we should close the browser request mode
  disableBrowserRequest: true,
  id: 'stepfun',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.stepfun.com/docs/llm/text',
  name: 'Stepfun',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.stepfun.com/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://stepfun.com',
};

export default Stepfun;
