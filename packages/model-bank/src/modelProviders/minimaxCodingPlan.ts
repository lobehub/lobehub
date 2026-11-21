import type { ModelProviderCard } from '../types';

// ref: https://platform.minimax.io/docs/coding-plan/intro
const MinimaxCodingPlan: ModelProviderCard = {
  chatModels: [],
  // The plan's text model is now M3.1 Flash; the M2 line was retired upstream.
  checkModel: 'MiniMax-M3.1-Flash',
  description:
    'MiniMax Token Plan provides access to MiniMax models including M3.1 Flash for coding tasks via a fixed-fee subscription.',
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
