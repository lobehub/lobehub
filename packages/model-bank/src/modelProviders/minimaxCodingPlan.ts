import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.minimax.io/docs/coding-plan/intro
const MinimaxCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'MiniMax-M2.7',
  description:
    'MiniMax Token Plan provides access to MiniMax models including M2.7 for coding tasks via a fixed-fee subscription.',
  disableBrowserRequest: true,
  id: 'minimaxcodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://platform.minimax.io/docs/coding-plan/intro',
  name: 'MiniMax Token Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.minimaxi.com/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://platform.minimax.io/subscribe/token-plan',
};

export default MinimaxCodingPlan;
