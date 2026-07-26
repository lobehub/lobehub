import type { ModelProviderCard } from '../types';

// ref: https://platform.moonshot.ai/docs
const KimiCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'k3',
  description:
    'Kimi Code from Moonshot AI provides access to Kimi models including K2.6, K2.7 Code, and K3 for coding tasks.',
  disableBrowserRequest: true,
  id: 'kimicodingplan',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html',
  name: 'Kimi Code',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.kimi.com/coding',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'anthropic',
    showDeployName: true,
    showModelFetcher: true,
  },
  url: 'https://www.kimi.com/code',
};

export default KimiCodingPlan;
