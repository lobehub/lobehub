import type { ModelProviderCard } from '@/types/llm';

// Ref: https://replicate.com/docs
const Replicate: ModelProviderCard = {
  chatModels: [],
  checkModel: 'black-forest-labs/flux-1.1-pro',
  description:
    'Replicate runs open-source image models like FLUX and Stable Diffusion via a simple cloud API.',
  id: 'replicate',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://replicate.com/explore',
  name: 'Replicate',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.replicate.com',
    },
    sdkType: 'replicate',
    showModelFetcher: true,
  },
  url: 'https://replicate.com',
};

export default Replicate;
