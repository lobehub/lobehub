import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.moonshot.ai/docs
const KimiCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'kimi-k2.5',
  description:
    'Kimi Code from Moonshot AI provides access to Kimi models including K2.5 for coding tasks.',
  disableBrowserRequest: true,
  id: 'kimicodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://platform.moonshot.ai/docs',
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
    showModelFetcher: false,
  },
  url: 'https://platform.moonshot.ai',
};

export default KimiCodingPlan;
