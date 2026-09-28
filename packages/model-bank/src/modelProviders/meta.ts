import type { ModelProviderCard } from '../types';

// ref: https://dev.meta.ai/docs
const Meta: ModelProviderCard = {
  chatModels: [],
  checkModel: 'muse-spark-1.3',
  description:
    'Meta builds AI models and products that help people connect, create, and get things done, including the Llama and Muse model families.',
  disableBrowserRequest: true,
  id: 'meta',
  modelsUrl: 'https://dev.meta.ai/docs/models',
  name: 'Meta',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.meta.ai/v1',
    },
    sdkType: 'openai',
  },
  url: 'https://dev.meta.ai',
};

export default Meta;
